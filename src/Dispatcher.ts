/**
 * Dispatcher — the runtime. Reads baton, picks the awake phase, builds the
 * TickContext, invokes the agent, runs gates, decides handoff.
 *
 * One Dispatcher instance per repo. Stateless across ticks (everything it
 * needs comes from disk). `tick()` runs exactly one phase × one (or N for
 * fanout) agent invocation(s). `loop()` runs `tick()` until hibernation.
 */

import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  rename,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  join,
  dirname,
  resolve,
  relative,
  isAbsolute,
  sep,
  toNamespacedPath,
} from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { tsImport } from "tsx/esm/api";

import type { Agent, NdjsonEvent } from "./Agent.js";
import { contentBlocksOfType, isAssistantEvent, isResultEvent, parseNdjsonLine } from "./Agent.js";
import { Baton } from "./Baton.js";
import type { Gate, GateResult } from "./Gate.js";
import { writablePathsGate } from "./builtinGates.js";
// §6: `buildFlumeApi` is a function, not a constant, precisely so this
// import participates safely in the builtinGates cycle — see its docstring.
import { buildFlumeApi, type FlumeApi } from "./flumeApi.js";
import { partitionByFileOverlap } from "./partition.js";
import { namespacedJoin } from "./paths.js";
import { declaredPaths, parsePending } from "./PendingSchema.js";
import type { EntryExtension, ParseError, PendingEntry } from "./PendingSchema.js";
import { countFrictionFiles } from "./job.js";

/**
 * Local-mutable shape for accumulating gate results before they widen to
 * TickResult.gateResults (which erases `details`) or a {@link TickVerdict}'s
 * `gateResults` (which keeps it) — `details` is where a failing
 * writable-paths gate lists the actual violating paths (v0.8 §5).
 */
type GateResultEntry = {
  gate: string;
  ok: boolean;
  message: string;
  details?: string;
};
import type { Chain, Phase, TickContext, TickResult } from "./Phase.js";
import { renderPrompt, InlineExecRenderError } from "./Prompt.js";
import type {
  PriorAttempt,
  GateRevertAttempt,
  VoluntaryBailAttempt,
  PlatformPreemptAttempt,
  RenderRefusedAttempt,
  TipMovedAttempt,
  NoCommitMode,
} from "./Prompt.js";
import * as git from "./git.js";

const execFileP = promisify(execFile);

/**
 * Prior-attempt records live beside the baton (`<flumeDir>/awake/`) —
 * gitignored harness runtime state under the flume state dir, NOT in the
 * per-entry worktree (a fanout retry gets a fresh worktree; the record must
 * outlive it). One JSON file per key: the entry tag slug (fanout) or phase
 * name (singleton).
 *
 * Session logs sit alongside under the same root (the dogfood chain places
 * them at `<flumeDir>/sessions/`), but that placement is chain-supplied, not
 * runtime: the runtime owns only `flumeDir` itself and the baton/prior-attempt
 * dirs it derives from it. A chain that captures sessions roots them under
 * `process.env.FLUME_DIR` so the whole footprint tears down in one `rm`.
 */
const PRIOR_ATTEMPTS_SUBDIR = "prior-attempts";

/**
 * §16 (RELEASE-v0.7): one pre-tick worktree provisioning failure — the
 * dispatcher never reached the agent for the affected entry (or, for a
 * repo-level failure, for any entry this tick).
 *
 * The exported name is pinned by `src/index.ts`'s barrel export and by
 * `tests/Dispatcher.test.ts`'s barrel-export pin, so it stays `ProvisionFailure`
 * — provision-stage only — even though {@link MergeFailure} and
 * {@link GateFailure} below now share its exact shape for the two stages
 * spec/loop.md's "Repeated identical failures" generalized the backstop to.
 */
export interface ProvisionFailure {
  /**
   * The entry tag this failure is scoped to (a `createWorktree` failure for
   * that specific slug). Absent for a repo-level failure (e.g. `git
   * worktree prune`) no single entry can be blamed for — the run-scoped
   * quarantine only ever isolates a *tagged* failure; an untagged one is
   * exactly the "non-entry-scoped" class the consecutive-failure backstop
   * exists for.
   */
  tag?: string;
  /**
   * Comparable signature — the same deterministic wall (e.g. the same held
   * directory) yields the same signature tick over tick, letting the
   * consecutive-failure backstop recognize a repeat without diffing full
   * error text.
   */
  signature: string;
  /** Full error message, for the quarantine/abort log lines. */
  message: string;
}

/**
 * A merge-stage failure (spec/loop.md "Repeated identical failures — quarantine,
 * then abort"): a cherry-pick conflict, or a dirty trunk refusing the pick, that
 * kept a worktree's already-agent-committed work off trunk. `tag` is the
 * fanout entry's tag; absent for a singleton phase's own merge-stage failure
 * (no entry to quarantine — same rationale as {@link GateFailure.tag}, it
 * falls to the consecutive-failure backstop alone).
 */
export interface MergeFailure {
  tag?: string;
  /** Same comparison-key contract as {@link ProvisionFailure.signature}. */
  signature: string;
  message: string;
}

/**
 * A gate-stage failure (spec/loop.md "Repeated identical failures — quarantine,
 * then abort"): an afterCommit or afterMerge gate that reverted a commit,
 * `signature` derived from the gate's own name plus its failure output. `tag`
 * is absent for a singleton phase's own gate revert (no entry to quarantine —
 * it falls to the consecutive-failure backstop alone) and present for a
 * fanout entry/wave gate revert.
 */
export interface GateFailure {
  tag?: string;
  /** Same comparison-key contract as {@link ProvisionFailure.signature}. */
  signature: string;
  message: string;
}

/** Bound on a persisted stage-failure signature (provision/merge/gate alike) — a comparison key, not a transcript. */
const MAX_FAILURE_SIGNATURE = 500;

/**
 * One gate's result as recorded in a {@link TickVerdict} — unlike
 * `TickResult.gateResults` (`./Phase.js`), this keeps `details`: for a
 * failing writable-paths gate that is the actual list of violating paths
 * (v0.8 §5's "gate results ... violating paths"), not a re-derived summary.
 */
export interface TickVerdictGateResult {
  gate: string;
  ok: boolean;
  message: string;
  details?: string;
}

/**
 * How a fanout entry's landed worktree commit fared once the wave tried to
 * put it on trunk (v0.8 §5's "cherry-pick/merge outcome"):
 *  - `merged`                cherry-picked, passed every afterMerge gate,
 *                            and the agent's own termination never stated a
 *                            park — counted shipped.
 *  - `cherry-pick-conflict`  the cherry-pick itself failed; entry stays
 *                            pending, no commit reached trunk.
 *  - `afterMerge-reverted`   landed, then an afterMerge gate failed; that
 *                            entry's commit alone was reset back off trunk.
 *  - `afterMerge-revert-refused` landed, an afterMerge gate failed, and the
 *                            `reset --keep` that would have carried the
 *                            commit back off trunk was itself refused — a
 *                            bystander's uncommitted work collides with the
 *                            paths the revert needs to touch (spec/loop.md
 *                            "Tip verify", "dropping it must not take
 *                            bystanders"). The commit stays on trunk, unlike
 *                            `afterMerge-reverted`; the entry stays pending
 *                            regardless, so it is never counted shipped. The
 *                            bounded exception to absorption the same
 *                            section names for a mid-history refusal —
 *                            evidence left for the operator rather than a
 *                            forced wipe.
 *  - `afterCommit-reverted`  reverted inside the worktree by an afterCommit
 *                            gate (§13, RELEASE-v0.7); never reached
 *                            cherry-pick, so it never touched trunk on its
 *                            own.
 *  - `not-shipped`           landed and passed every gate, but the phase's
 *                            own `shipped` predicate returned false (spec/
 *                            pending.md "Ship detection trusts the agent's
 *                            own account") — commit stays on trunk, entry
 *                            stays pending. The engine records the chain's
 *                            verdict and holds no vocabulary for its reason.
 *  - `tip-moved`             the wave's own commit-onto-trunk step refused
 *                            because a live claim held the ref (a concurrent
 *                            engine instance, spec/loop.md "Tip verify") —
 *                            never reached cherry-pick, entry stays pending
 *                            for a fresh retry once the claim clears. A
 *                            foreign non-engine commit on the ref, with no
 *                            live claim, is absorbed instead: git's own
 *                            conflict detection is the only content arbiter.
 *  - `dropped-work`          the per-entry tip-verify leg's own ancestry
 *                            check refused (spec/loop.md "Tip verify",
 *                            per-entry leg): this entry's worktree commit
 *                            was soft-reset because its recorded base was no
 *                            longer an ancestor of the observed HEAD — never
 *                            reached cherry-pick either, but distinct from
 *                            `tip-moved` above, which is the *shared trunk*
 *                            racing during this wave's own merge step. A
 *                            sibling fact so a dropped per-entry commit
 *                            never lands as silence a partial ship summary
 *                            papers over.
 */
export type MergeOutcome =
  | "merged"
  | "cherry-pick-conflict"
  | "afterMerge-reverted"
  | "afterMerge-revert-refused"
  | "afterCommit-reverted"
  | "not-shipped"
  | "tip-moved"
  | "dropped-work";

/**
 * One fanout entry's {@link MergeOutcome}, as recorded in a {@link
 * TickVerdict}. `footprint` is the entry's actual touched paths — present
 * on the outcomes that never landed cleanly on trunk (`cherry-pick-conflict`,
 * `afterMerge-reverted`, `afterCommit-reverted`) where a captured diff
 * exists; absent when the outcome carries no footprint of its own (`merged`,
 * `not-shipped`, or a best-effort capture that failed). `commitPendingUpdate`
 * sources a wave's footprint commit from this same field (v0.8 §5: "now
 * generated from the same verdict record rather than separate capture") —
 * no independently-maintained observed-files map.
 */
export interface TickVerdictMergeOutcome {
  tag: string;
  outcome: MergeOutcome;
  footprint?: string[];
  /**
   * The span's own head — the entry's cherry-picked commit sha once one
   * exists (`merged`, `afterMerge-reverted`, `not-shipped`), else the
   * worktree-branch commit sha the entry never got past (`tip-moved`,
   * `dropped-work`, `afterCommit-reverted`). Recovery, not decoration: a span
   * parked or refused after its gates passed must be re-cherry-pickable from
   * the verdict alone, never re-run at full agent price — worktree teardown
   * deletes the branch, but the commit object survives in the shared store
   * until gc, and this is the only place its sha outlives the branch. Absent
   * only when the entry never reached a commit at all.
   */
  headSha?: string;
}

/**
 * v0.8 §5: the one facts artifact every tick that actually runs a phase
 * writes — phase, entry tag(s), committed/no-commit class, gate results,
 * shipped tags, and (fanout) each provisioned entry's cherry-pick/merge
 * fate. Supersedes three v0.7 partial channels: the §4-amendment
 * `last-tick.json` counts file, §13's footprint-only capture, and §15's
 * in-process-only `TickResult.noCommit`.
 *
 * No interpretation fields: this is what happened, never what it means —
 * "park", "bail worth waking for" are a chain's own readings, not engine
 * vocabulary. `errored` (v0.7 §4's run-level failure classification) is
 * deliberately absent from this shape for the same reason: `superviseLoop`
 * derives it from the facts below at the read site (see its call to {@link
 * readTickVerdict}) rather than storing a precomputed judgment on disk.
 */
export interface TickVerdict {
  phaseName: string;
  /**
   * Entry tags this tick provisioned a worktree/agent for; empty for a
   * singleton phase or a fanout wave with nothing pickable.
   */
  tags: string[];
  committed: boolean;
  /**
   * RELEASE-v0.2 §6 no-commit classification, present iff the tick (or, for
   * a fanout wave, the whole wave) produced no usable commit. Absent on a
   * committed tick or a nothing-pickable no-op (no agent ran).
   */
  noCommit?: NoCommitMode;
  /**
   * RELEASE-v0.11 §5: set when this tick (or, for a fanout wave, any part of
   * it) refused to commit because the ref moved between the tip it recorded
   * at tick start and the point a commit would have landed onto it — the
   * tip-verify backstop. A sibling fact to `noCommit`, never folded into it:
   * the cause here is never one of the four `NoCommitMode` classes, and a
   * wave can carry both (some entries shipped before the ref moved, the rest
   * refused) or `tipMoved` alone with `committed: true` (every entry that
   * reached cherry-pick shipped; only the trailing pending-ledger commit
   * refused). Absent when nothing this tick touched hit the backstop.
   */
  tipMoved?: boolean;
  /**
   * RELEASE-v0.11 §8: set when this tick (or, for a fanout wave, any part
   * of it) never invoked the agent because `phase.shouldRun` returned
   * `false` — a sibling fact to `noCommit`/`tipMoved`, never a fifth
   * `NoCommitMode`: the chain declined the tick outright, which is not one
   * of the four causally-distinct no-commit classes (no agent ran, so
   * nothing to classify) and not the tip-verify backstop (nothing raced).
   * A wave can carry both `declined` and `shippedTags`/`committed: true`
   * (one entry declined while its siblings ran and shipped) or `declined`
   * alone with `committed: false` (every provisioned entry declined).
   * Absent when nothing this tick touched hit a `shouldRun` refusal.
   */
  declined?: boolean;
  /** Every gate that ran this tick, in run order, across every entry. */
  gateResults: TickVerdictGateResult[];
  /** Entry tags shipped by this tick (entries the phase's `shipped` predicate rejected already excluded); empty for a singleton phase. */
  shippedTags: string[];
  /** Fanout only; empty for a singleton phase or a wave with nothing provisioned. */
  mergeOutcomes: TickVerdictMergeOutcome[];
  /**
   * §16 (RELEASE-v0.7): pre-tick worktree provisioning failures (sweep or
   * create) this tick recorded, before any agent ran for the affected
   * entries. Absent/empty when the tick hit none.
   */
  provisionFailures?: ProvisionFailure[];
  /**
   * §16 (generalized past provisioning, spec/loop.md "Repeated identical
   * failures"): merge-stage cherry-pick-conflict failures this tick recorded.
   * Absent/empty when the tick hit none.
   */
  mergeFailures?: MergeFailure[];
  /**
   * §16 (generalized past provisioning): gate-stage failures — an afterCommit
   * or afterMerge gate revert — this tick recorded. Absent/empty when the
   * tick hit none.
   */
  gateFailures?: GateFailure[];
  /** This tick's one-line logger summary, verbatim — a rendering of the facts above, not a judgment of them. */
  summary: string;
}

/** Shared return shape for {@link Dispatcher.runSingleton} and {@link Dispatcher.runFanout}. */
type PhaseTickOutcome = {
  result: TickResult;
  noCommit?: NoCommitMode;
  /** RELEASE-v0.11 §5: sibling to `noCommit` — see {@link TickVerdict.tipMoved}. */
  tipMoved?: boolean;
  /** RELEASE-v0.11 §8: sibling to `noCommit`/`tipMoved` — see {@link TickVerdict.declined}. */
  declined?: boolean;
  provisionFailures?: ProvisionFailure[];
  /** §16 (generalized) — see {@link TickVerdict.mergeFailures}. */
  mergeFailures?: MergeFailure[];
  /** §16 (generalized) — see {@link TickVerdict.gateFailures}. */
  gateFailures?: GateFailure[];
  /** Entry tags this wave provisioned a worktree/agent for (fanout only; §5); absent for a singleton phase. */
  tags?: string[];
  /** Fanout only (§5): each provisioned entry's cherry-pick/merge fate; absent for a singleton phase. */
  mergeOutcomes?: TickVerdictMergeOutcome[];
};

/**
 * v0.8 §5: two files under the state dir, both stable paths, neither a
 * dogfood convention:
 *  - {@link TICK_VERDICT_FILE} — this tick's verdict alone, overwritten
 *    every real `flume tick` process (the CLI's `tick` command writes it,
 *    from the `TickVerdict` its own `dispatcher.tick()` call returned —
 *    never `Dispatcher.tick()` itself, which plain unit tests call directly
 *    and must not gain an untracked side effect underfoot). `clearTickVerdict`
 *    removes it before that same tick's own work begins, so a tick that
 *    never reaches the write (chain-load failure, hibernation, terminal
 *    misconfiguration) leaves nothing for `superviseLoop` to misread as its
 *    own. Untracked, ungitignored (same tolerance as the loop lock's own
 *    `<flumeDir>/loop.pid`).
 *  - {@link TICK_VERDICTS_LOG_FILE} — every verdict ever written, appended
 *    and bounded to {@link MAX_TICK_VERDICTS}, read back by the exported
 *    `readTickVerdicts` accessor so a chain can render recent tick history
 *    into a prompt. Never cleared — it is history, not a per-tick signal.
 */
const TICK_VERDICT_FILE = "tick-verdict.json";
const TICK_VERDICTS_LOG_FILE = "tick-verdicts.jsonl";
/** Bound on {@link TICK_VERDICTS_LOG_FILE} — a rolling window, not an unbounded log. */
const MAX_TICK_VERDICTS = 200;

function tickVerdictPath(flumeDir: string): string {
  return join(flumeDir, TICK_VERDICT_FILE);
}

function tickVerdictsLogPath(flumeDir: string): string {
  return join(flumeDir, TICK_VERDICTS_LOG_FILE);
}

/** Structural check a parsed JSON value is shaped like a {@link TickVerdict} — corrupt or partial input degrades to "not a verdict", never a thrown parse error surfacing as a tick failure. */
function isTickVerdict(rec: unknown): rec is TickVerdict {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as Partial<TickVerdict>;
  return (
    typeof r.phaseName === "string" &&
    typeof r.committed === "boolean" &&
    Array.isArray(r.tags) &&
    Array.isArray(r.gateResults) &&
    Array.isArray(r.shippedTags) &&
    Array.isArray(r.mergeOutcomes) &&
    typeof r.summary === "string"
  );
}

/**
 * Write this tick's verdict: overwrite the latest-tick file `superviseLoop`
 * reads between iterations, and append the same record to the bounded
 * history log the exported `readTickVerdicts` accessor serves. Called by
 * the CLI's `tick` command, once per real process, from the `TickVerdict`
 * its own `dispatcher.tick()` call returned.
 */
export async function writeTickVerdict(
  flumeDir: string,
  verdict: TickVerdict,
): Promise<void> {
  // win32 MAX_PATH: flumeDir nests under a job/worktree root; namespacedJoin
  // (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(flumeDir), { recursive: true });
  await writeFile(
    namespacedJoin(tickVerdictPath(flumeDir)),
    JSON.stringify(verdict),
    "utf8",
  );
  const history = await readTickVerdicts(flumeDir);
  const bounded = [...history, verdict].slice(-MAX_TICK_VERDICTS);
  await writeFile(
    namespacedJoin(tickVerdictsLogPath(flumeDir)),
    bounded.map((v) => JSON.stringify(v)).join("\n") + "\n",
    "utf8",
  );
}

/**
 * Clear a stale latest-tick verdict before a tick's own work — called by
 * the CLI's `tick` command before invoking `dispatcher.tick()`. Leaves the
 * history log untouched: clearing is a per-tick-signal concern, not a
 * history one.
 */
export async function clearTickVerdict(flumeDir: string): Promise<void> {
  await rm(namespacedJoin(tickVerdictPath(flumeDir)), { force: true });
}

/**
 * Read the last-written verdict, if any — consulted by `superviseLoop`
 * between child ticks. Corrupt or absent (the CLI clears it before every
 * tick and writes it only once that tick's `dispatcher.tick()` call has
 * returned) degrades to "nothing to report" — a missing record must never
 * be misread as a prior tick's stale one.
 */
async function readTickVerdict(
  flumeDir: string,
): Promise<TickVerdict | undefined> {
  const p = namespacedJoin(tickVerdictPath(flumeDir));
  if (!existsSync(p)) return undefined;
  try {
    const rec: unknown = JSON.parse(await readFile(p, "utf8"));
    return isTickVerdict(rec) ? rec : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read up to the last `n` verdicts (oldest first), for a chain to render
 * recent tick history into a prompt (v0.8 §5). Corrupt lines are skipped,
 * never thrown; an absent log reads as empty history — same no-false-signal
 * posture as every other artifact this dispatcher persists.
 */
export async function readTickVerdicts(
  flumeDir: string,
  n: number = MAX_TICK_VERDICTS,
): Promise<TickVerdict[]> {
  const p = namespacedJoin(tickVerdictsLogPath(flumeDir));
  if (!existsSync(p)) return [];
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch {
    return [];
  }
  const verdicts: TickVerdict[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec: unknown = JSON.parse(trimmed);
      if (isTickVerdict(rec)) verdicts.push(rec);
    } catch {
      // a corrupt line is skipped, not fatal to the rest of the history
    }
  }
  return n === 0 ? [] : verdicts.slice(-n);
}

/** Telegraphic-prose bound on persisted gate details — a digest, not a transcript. */
const MAX_PRIOR_DETAILS = 8 * 1024;
/** Bound on the persisted `git show --stat` digest. */
const MAX_PRIOR_DIFFSTAT = 4 * 1024;
/**
 * Bound on the persisted voluntary-bail constraint / platform-preempt
 * failure class. Same telegraphic discipline as the gate digest: enough to
 * name the wall, not the transcript.
 */
const MAX_PRIOR_NOCOMMIT = 4 * 1024;

/**
 * How an agent invocation ended. A clean exit with no commit is a
 * voluntary-bail (the agent refused a constraint and said so in its final
 * message, captured here as `stdout`); any process failure is a
 * platform-preempt (not a defect in the work) — §6 classification consults
 * this distinction only when the tick produced no commit.
 *
 * When a commit lands, `runFanout`'s ship classification consults it too
 * (spec/pending.md "Ship detection trusts the agent's own account", ruling
 * 2026-08-03): a `clean` termination's final message is the agent's own
 * account of what it did, so a stated park there still keeps the entry out
 * of `shipped` even though its commit landed and its gates passed. A
 * `process-failure` never "says" anything of its own — `failureClass` is
 * engine-authored, not agent prose — so it never blocks shipping on that
 * basis; a commit it left behind is honored exactly as a clean one would be.
 */
type AgentTermination =
  | { kind: "clean"; stdout: string }
  | { kind: "process-failure"; failureClass: string };

/**
 * Filesystem-safe slug for a pending tag — shared by worktree + prior-attempt
 * keying. Never lengthens the input (runs of disallowed chars collapse to a
 * single `-`), so anything bounding raw `tag` length also bounds this.
 *
 * `tag` itself is length-bounded at the schema gate (v0.8 §3,
 * `PendingSchema.ts` `TAG_MAX_LENGTH`), derived from this module's own
 * tightest raw-tag consumer, `writeRevertNote`'s
 * `` `${stamp}--${entry.tag}--reverted.md` `` — every tag-derived path
 * component here (this `slug`/`createWorktree`'s worktree-dir and
 * branch-name, `harvestFriction`'s `` `${tag}--${stamp}--${file.name}` ``)
 * is looser and stays within filesystem NAME_MAX (255) by construction as a
 * result.
 * Agreement between the two sides is pinned by tests/Dispatcher.test.ts,
 * "revert note to the friction channel (§5)", not asserted here.
 */
function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

/**
 * Length bound for `createWorktree`'s directory-name component only (§9,
 * v0.11). `git worktree add` refuses a worktree path around 200 chars on
 * win32 (`fatal: '$GIT_DIR' too big`) — below MAX_PATH, unaffected by
 * `core.longpaths`, and unreachable by `toNamespacedPath`/`namespacedJoin`
 * because git builds that path itself before any Node fs call sees it.
 * `TAG_MAX_LENGTH` (`PendingSchema.ts`) sizes the schema off NAME_MAX (255),
 * a wider ceiling, so a schema-valid tag's raw slug can already exceed this
 * one. Chosen with room to spare under a `wtBase`/namespace prefix, not
 * tuned to the measured ~200-char wall itself.
 */
const WORKTREE_DIRNAME_MAX = 48;

/**
 * `createWorktree`'s fs directory name for an entry's tag — truncated to
 * `WORKTREE_DIRNAME_MAX` with a hash of the *full* tag appended so two tags
 * sharing a long common prefix still land on distinct directories. Only the
 * filesystem component is bounded: the branch name and the §5 prior-attempt
 * key keep the untruncated `slugify(entry.tag)`, since neither is a git-
 * constructed worktree path and both are already bounded by the schema's
 * own `TAG_MAX_LENGTH`.
 */
export function worktreeDirName(tag: string): string {
  const slug = slugify(tag);
  if (slug.length <= WORKTREE_DIRNAME_MAX) return slug;
  const hash = createHash("sha1").update(tag).digest("hex").slice(0, 10);
  return `${slug.slice(0, WORKTREE_DIRNAME_MAX - hash.length - 1)}-${hash}`;
}

/** Cap a string to `max` chars, marking the elision so truncation is visible. */
function bound(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

/**
 * Keep the *last* `max` chars (the agent's final message — where a bail
 * names its refused constraint — lives at the tail of stdout), marking the
 * elision at the head so truncation is visible.
 */
function tailBound(s: string, max: number): string {
  if (s.length <= max) return s;
  return `[truncated ${s.length - max} chars]…\n` + s.slice(s.length - max);
}

/**
 * {@link GateFailure.signature}: derived from the gate's own name plus its
 * failure output, so two different gates failing with the same message text
 * (or the same gate failing with two different messages) never collide.
 */
function gateFailureSignature(failure: { gate: string; message: string }): string {
  return bound(`${failure.gate}: ${failure.message}`.trim(), MAX_FAILURE_SIGNATURE);
}

// ---------- public surface ----------

/**
 * Three-level logging seam. The dispatcher writes harness narration through
 * these methods; consumers can route them to a structured logger or simply
 * pass `consoleLogger` (the default).
 */
export interface Logger {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/**
 * Default `Logger` implementation: `info` → `console.log`, `warn` →
 * `console.warn`, `error` → `console.error`. Used by the dispatcher when
 * `DispatcherOptions.log` is omitted.
 */
export const consoleLogger: Logger = {
  info: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

/**
 * What a chain factory returns (RELEASE-v0.11 §6): the `Chain` plus an
 * optional `agent` override and an optional `forkResolver` (the foundations
 * governor, §v0.3). The per-tick resolver returns this; a rewritten chain.ts
 * changes all three for the next tick.
 *
 * `agent` and `forkResolver` ride the factory's return rather than named
 * module exports because a named export cannot receive the API — leaving
 * them as exports would preserve exactly the resolution path §6 removes.
 */
export interface ChainModule {
  chain: Chain;
  agent?: Agent;
  forkResolver?: (repoRoot: string) => (slug: string) => boolean;
}

/**
 * What `.flume/chain.ts` default-exports (RELEASE-v0.11 §6): a factory the
 * engine calls with its own surface. The chain imports no engine *value*, so
 * a second physical engine in one process is unreachable rather than merely
 * detected.
 */
export type ChainFactory = (api: FlumeApi) => ChainModule;

/**
 * Load + normalize + validate a chain module from an absolute `chain.ts`
 * path. Throws on a missing file, a compile/syntax error, or a shape that
 * isn't a Chain (no resolvable default export, or `phases` not an array).
 *
 * This is the single load+validate path the runtime trusts. `diskChainLoader`
 * wraps it (one load per call, no memo); `chainLoadGate` (builtinGates) calls
 * it to validate a just-committed `chain.ts` so a broken self-edit fails its
 * gate and is reverted before the next tick's process resolves it.
 *
 * tsImport (tsx/esm/api) compiles the .ts source in-process so the published
 * dist/cli.js can resolve consumer chain.ts files without a node loader flag
 * (plain `await import()` would fail: node refuses .ts under node_modules,
 * and consumer .flume/chain.ts is a .ts file regardless of where flume lives).
 *
 * In-process this returns a *pinned* evaluation: Node's ESM module registry
 * is keyed by resolved URL and is non-evictable, so a fixed-path chain.ts is
 * frozen to its first load for the life of the process (verified on tsx 4.21
 * / Node 22.21 — no query string, tsImport namespace, or loader
 * re-registration evicts it). That is *why* per-tick re-resolution is a
 * process boundary, not in-process re-eval: `flume loop` spawns one
 * `flume tick` per iteration (§2), each a fresh process that loads chain.ts
 * exactly once. A rewritten chain.ts governs the next tick because the next
 * tick is a new process — not because anything re-imports it in-process.
 */
/**
 * Validate a declared `Chain.friction` (§2, v0.6.2): must be relative and
 * must resolve inside the state root, else a usage-shaped error. The check
 * is base-independent — it resolves the declared path against an arbitrary
 * sentinel root and asks whether the result still sits under that root —
 * so it needs no actual `flumeDir` value. That value legitimately varies
 * per call site (a job-scoped run's state root differs from `configDir`,
 * where `chain.ts` itself lives), but "does this relative path escape
 * whatever root it's joined to" is a property of the path string alone.
 * Undeclared `friction` is a strict no-op, per §2.
 */
function validateFrictionDeclaration(chain: Chain): void {
  if (chain.friction === undefined) return;
  const friction = chain.friction;
  if (isAbsolute(friction)) {
    throw new Error(
      `chain declares friction '${friction}' as an absolute path; ` +
        `Chain.friction must be a state-root-relative directory path (e.g. "friction")`,
    );
  }
  const sentinelRoot = resolve("__flume_state_root__");
  const resolved = resolve(sentinelRoot, friction);
  const rel = relative(sentinelRoot, resolved);
  const escapesRoot =
    rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapesRoot) {
    throw new Error(
      `chain declares friction '${friction}' which resolves outside the state root; ` +
        `Chain.friction must be a state-root-relative directory path (e.g. "friction")`,
    );
  }
}

/**
 * Refuse the one decidable dead-declaration shape (§2, *A dead declaration
 * is refused at load*): a chain field whose only consumer is statically
 * unreachable from the rest of the same declaration. Checkable from the
 * declaration alone, no tick required, so the loader — not a tick — refuses
 * it.
 *
 * `phase.entryChannelPaths` is only consulted on a scoped tick
 * (`phase.scopeWritesToEntry === true`); declared without the flag it
 * governs nothing. Emptiness doesn't matter — `[]` on a scoped phase is
 * live (it just adds no extra globs); the field's *presence* without the
 * flag is what's dead.
 */
function validateNoDeadDeclarations(chain: Chain): void {
  for (const phase of chain.phases) {
    if (phase.entryChannelPaths !== undefined && !phase.scopeWritesToEntry) {
      throw new Error(
        `phase '${phase.name}' declares entryChannelPaths without scopeWritesToEntry: true; ` +
          `entryChannelPaths is only consulted on a scoped tick, so it governs nothing here. ` +
          `Set scopeWritesToEntry: true on '${phase.name}', or remove entryChannelPaths.`,
      );
    }
  }
}

/**
 * The friction count line shared by `flume status`, `flume job status`, and
 * the loop-end summary (§6, v0.6.2): count of files directly under the
 * declared friction dir, resolved against `stateRoot` — whichever state
 * root is in play for the caller (the repo's `flumeDir`, or a job's dir).
 * `undefined` when `Chain.friction` is undeclared, the dir is absent
 * (`ENOENT`), or it holds no files — callers print a line only when this
 * resolves to a string (§6: "when declared and non-empty"). When the dir
 * exists but `readdir` fails for any other reason (permission denied, a
 * path too long for the platform, …), that is a real unresolved input, not
 * a legitimate zero: it reads `"friction: unreadable"` rather than folding
 * into the same silence as "nothing declared" or "nothing filed"
 * (`.claude/rules/engineering.md`, "Loud or nothing") — the same split
 * `countFrictionFiles` (`src/job.ts`) gives `flume job status`, reused here
 * rather than re-derived (`.claude/rules/engineering.md`, "the fix lands at
 * the mechanism").
 */
export async function frictionCountLine(
  stateRoot: string,
  chain: Chain,
): Promise<string | undefined> {
  if (chain.friction === undefined) return undefined;
  // win32 MAX_PATH (`.claude/rules/platform-facts.md`): same join(stateRoot,
  // chain.friction) construction writeRevertNote and harvestFriction guard
  // below — namespacedJoin (src/paths.ts) is the shared idiom.
  const count = countFrictionFiles(namespacedJoin(stateRoot, chain.friction));
  if (count === null) return "friction: unreadable";
  return count > 0 ? `friction: ${count} note(s) await routing` : undefined;
}

/**
 * tsx's ESM loader failing to recognize the chain as a module because the
 * host repo's `package.json` (or one beside `.flume/chain.ts`) lacks
 * `"type": "module"` (RELEASE-v0.7 §5) — two known empirical shapes:
 * tsx 4.21 falls through to a CJS parse of the compiled output and Node's
 * CJS loader rejects the `import`/`export` syntax outright; tsx 4.23
 * instead fails resolution one step earlier, `ERR_MODULE_NOT_FOUND` against
 * a path carrying its internal `tsImport` `?namespace=` query, percent-
 * encoded because the failed resolution treated the query as part of a
 * literal file path. Declining to support CJS-context hosts (§1); this
 * class exists only so `loadChainModule`'s caller can refuse with a fix
 * instead of relaying either raw shape as a stack trace.
 */
export class CjsContextLoadError extends Error {
  constructor(chainPath: string, cause: Error) {
    super(
      `${chainPath} failed to load: tsx's ESM loader can't parse it as a ` +
        `module. Fix: add "type": "module" to this repo's package.json ` +
        `(or one beside .flume/chain.ts). Flume does not support a ` +
        `CJS-context host otherwise. (raw loader error, for debugging: ` +
        `${cause.message})`,
    );
    this.name = "CjsContextLoadError";
  }
}

const CJS_CONTEXT_IMPORT_OUTSIDE_MODULE =
  /Cannot use import statement outside a module/;
const CJS_CONTEXT_NAMESPACE_QUERY = /%3Fnamespace%3D/i;

/**
 * Empirical match only (§5) — never a false positive at the cost of missing
 * a shape: a genuinely missing dependency (a bare `ERR_MODULE_NOT_FOUND`
 * with no `tsImport` namespace query in the path) must keep surfacing as
 * itself, unshadowed by this refusal.
 */
function isCjsContextLoadFailure(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  if (CJS_CONTEXT_IMPORT_OUTSIDE_MODULE.test(err.message)) return true;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === "ERR_MODULE_NOT_FOUND" &&
    CJS_CONTEXT_NAMESPACE_QUERY.test(err.message)
  );
}

export async function loadChainModule(path: string): Promise<ChainModule> {
  // win32 MAX_PATH: the single fix point for this check — every caller
  // (job.ts's jobNew/jobRun, builtinGates.ts's chainLoadGate, this file's
  // own default loader) reaches an existing chain.ts through here.
  // namespacedJoin (src/paths.ts) is the shared idiom.
  if (!existsSync(namespacedJoin(path))) {
    throw new Error(
      `chain config not found at ${path}; create .flume/chain.ts that default-exports a Chain.`,
    );
  }
  let ns: Record<string, unknown>;
  try {
    ns = (await tsImport(
      pathToFileURL(path).href,
      import.meta.url,
    )) as Record<string, unknown>;
  } catch (err) {
    if (isCjsContextLoadFailure(err)) {
      throw new CjsContextLoadError(path, err);
    }
    throw err;
  }

  // tsx compiles a default-ONLY .ts module to CJS interop, so the namespace
  // is { default: { __esModule: true, default: <realDefault> } }. A module
  // with named exports stays true ESM: ns.default is the value directly.
  // Normalize both shapes — the documented minimal chain (default export
  // only) hits the interop path.
  const d = ns.default as Record<string, unknown> | undefined;
  const interop =
    !!d &&
    (d as { __esModule?: boolean }).__esModule === true &&
    "default" in d;
  const factory = (interop ? d!.default : d) as ChainFactory | undefined;

  // §6: a non-function default export is refused, never accepted as the
  // pre-§6 `Chain` object. A silent fallback would readmit the very thing
  // the section removes — a chain resolving engine values through its own
  // import, and with them a second physical engine.
  if (typeof factory !== "function") {
    throw new Error(
      `${path} must default-export a chain factory: (api) => ({ chain }). ` +
        `Default-exporting a Chain object is the pre-0.10 shape — wrap it in a ` +
        `factory and take engine values from the parameter instead of importing ` +
        `them (see docs/MIGRATING-0.10.md § 2).`,
    );
  }

  const module = factory(buildFlumeApi()) as ChainModule | undefined;

  // A returned thenable means an async factory: §6 specifies a synchronous
  // one, and awaiting here would silently accept a shape the contract does
  // not carry. Name it rather than failing later on `chain.phases`.
  if (module && typeof (module as { then?: unknown }).then === "function") {
    throw new Error(
      `${path}'s chain factory returned a Promise; the factory must be synchronous. ` +
        `Do async work inside a phase hook (setupWorktree, gates), not at chain build time.`,
    );
  }

  const chain = module?.chain;
  if (!chain || !Array.isArray((chain as { phases?: unknown }).phases)) {
    throw new Error(
      `${path}'s chain factory must return { chain } where chain has a phases[] array`,
    );
  }
  validateFrictionDeclaration(chain);
  validateNoDeadDeclarations(chain);
  const result: ChainModule = { chain };
  if (module.agent) result.agent = module.agent;
  if (module.forkResolver) result.forkResolver = module.forkResolver;
  return result;
}

/**
 * Build the default per-tick chain resolver: load `<configDir>/chain.ts` via
 * `loadChainModule`, once per call. No memoization: each `flume tick` is a
 * fresh process (§2), so there is exactly one resolution per process and
 * nothing to memoize across — cost is one small `tsImport` per tick,
 * dominated by orders of magnitude by the agent invocation.
 *
 * Injecting `DispatcherOptions.chainLoader` replaces this wholesale — the
 * in-process unit-test seam (tests call `tick()` directly, no subprocess).
 */
export function diskChainLoader(configDir: string): () => Promise<ChainModule> {
  return () => loadChainModule(resolve(configDir, "chain.ts"));
}

/**
 * Constructor input for `Dispatcher`. `repoRoot`, `configDir`, and `agent`
 * are required; the rest tune chain resolution, concurrency, trunk
 * identification, logging, and per-tick wall-clock budget.
 *
 * No prebuilt `Chain` is accepted — the dispatcher resolves
 * `<configDir>/chain.ts` once at the start of its tick. Re-resolution across
 * ticks is a process boundary, not in-process: `flume loop` spawns one
 * `flume tick` per iteration (§2), so a tick that rewrites the chain is
 * governed by the new chain on the next tick's fresh process.
 */
export interface DispatcherOptions {
  repoRoot: string;
  /** Directory the chain config (and its prompt files) live in. */
  configDir: string;
  /**
   * Mutable-state root: where the baton (`awake/`), pending
   * (`plan/pending.json`), worktrees (`worktrees/`), and prior-attempt records
   * (`prior-attempts/`) live. Defaults to `<repoRoot>/.flume` — the historical
   * fixed location. Relocate it to run a fully self-contained, ephemeral
   * harness whose entire footprint can be removed in one `rm` (the
   * attach-work-detach posture: state never bleeds into `<repoRoot>/.flume`).
   * Independent of `configDir`; set both to the same dir to co-locate config
   * and state.
   */
  flumeDir?: string;
  /**
   * Fanout branch namespace (v0.5 §4). When set, ephemeral worktree branches
   * are `flume/<namespace>/<slug>` instead of the repo-global `flume/<slug>`,
   * and worktree paths are `<wtBase>/<namespace>/<slug>` instead of
   * `<wtBase>/<slug>`, so two jobs whose pending entries share a tag slug fan
   * out onto disjoint branches AND disjoint paths (a shared
   * FLUME_WORKTREES_DIR would otherwise clobber). Resolved by the CLI from
   * `FLUME_JOB` and passed down explicitly — the dispatcher never sniffs
   * `flumeDir` for a job name.
   */
  namespace?: string;
  /**
   * Default agent. Per-tick resolution is
   * `phase.agent ?? chainModule.agent ?? this` — a `chain.ts` that exports
   * `agent` overrides this (the agent re-resolves with the chain), and a
   * phase carrying its own `agent` overrides both for its ticks.
   */
  agent: Agent;
  /**
   * Chain resolver, invoked once per tick. Defaults to
   * `diskChainLoader(configDir)` (one load of `<configDir>/chain.ts` per
   * process). Override for in-process test injection only (no subprocess).
   */
  chainLoader?: () => Promise<ChainModule>;
  /**
   * Foundations governor (§v0.3). Given the repo root, returns a predicate
   * answering "is this open-question fork resolved?". Consulted once per tick;
   * an entry whose `dependsOnForks` contains any unresolved slug is not
   * pickable, skipped in favour of a foundation-settled sibling (or the tick
   * idles if none). Default: every fork resolved — a chain that supplies no
   * resolver is behaviourally identical to v0.2. The runtime stays
   * format-agnostic: how a project records and resolves forks lives in the
   * resolver, not here.
   */
  forkResolver?: (repoRoot: string) => (slug: string) => boolean;
  log?: Logger;
  /**
   * Max parallel ticks per fanout batch. Default 4. Overridable per chain via
   * `Chain.supervisorPolicy.maxParallel` (`src/Phase.ts`), which `runFanout`
   * prefers when declared — this option is the fallback below it, for a
   * programmatic embedder that wants a floor the chain doesn't set.
   */
  maxParallel?: number;
  /**
   * Wall-clock timeout per agent invocation in milliseconds. When exceeded,
   * the underlying agent process is aborted; the dispatcher logs a warning
   * and the tick continues with whatever the agent committed (typically
   * nothing, so the phase falls through with `committed: false`). Default:
   * unset — a hung agent will block the tick indefinitely. Overridable per
   * chain via `Chain.supervisorPolicy.tickTimeoutMs` (`src/Phase.ts`), which
   * both `runSingleton` and `runFanoutEntry` prefer when declared — this
   * option is the fallback below it, for a programmatic embedder that wants
   * a cap the chain doesn't set.
   */
  tickTimeoutMs?: number;
  /**
   * §16 (RELEASE-v0.7): entry-tag slugs excluded from this tick's fanout
   * pick even though `pending.json` still lists them as pickable —
   * `pending.json` itself is untouched. The `flume loop` supervisor
   * populates this (via the `tick` command's `FLUME_QUARANTINED_SLUGS` env
   * var) from entries whose pre-tick worktree provisioning failed earlier
   * in the run; the exclusion is run-scoped only — a fresh run/process
   * always starts with nothing quarantined. Default: nothing quarantined.
   */
  quarantinedSlugs?: ReadonlySet<string>;
  /**
   * spec/loop.md "The loop lock and the tip claim": the pid of the tip
   * claim *this run* operates under — its own (a bare `flume tick`, which
   * acquires directly in-process, so this equals `process.pid`) or its
   * supervisor's (a loop-spawned child, told via `FLUME_TIP_CLAIM_HELD`).
   * `liveForeignClaimPid` (the wave's own tip-verify check, consulted before
   * every cherry-pick and before the pending-ledger commit) excludes a live
   * claim matching this pid — without it, a run's own claim reads as a
   * concurrent engine instance to its own wave, which refuses every
   * cherry-pick against itself. Engine-boundary.md "Told, not inferred":
   * the CLI states which pid is self; the dispatcher never guesses from a
   * bare pid match, which a unit test constructing a `Dispatcher` directly
   * (no real claim of its own) relies on to keep simulating a genuinely
   * foreign claim. Default: unset — every live claim reads as foreign,
   * unchanged behavior for a caller that never acquired one.
   */
  ownTipClaimPid?: number;
  /**
   * Override for the pending-ledger commit's message (engine-boundary.md
   * "Capability vs convention"). `commitPendingUpdate` calls this with the
   * tags shipped this wave (empty when the wave only recorded merge-failure
   * footprints) and the tags whose footprints were recorded, and commits
   * pending.json with whatever string it returns. The `chore(flume): ship
   * ...` / `chore(flume): record merge-failure footprints for ...` wording
   * is this harness's own convention, not something every chain need adopt.
   * Default (omitted): reproduces that exact text.
   */
  commitMessage?: (
    shippedTags: readonly string[],
    footprintTags: readonly string[],
  ) => string;
}

/**
 * `flume tick` exit code for an Axis-C terminal misconfiguration (§3):
 * sysexits.h `EX_CONFIG`. Distinct from 0 (clean hibernate), 1 (other
 * harness errors), and {@link EX_MOUNT_DEAD} (the chain never resolved at
 * all) so the process boundary classifies the failure without reading logs.
 * `superviseLoop` fail-fasts on a child exiting with this code.
 */
export const EX_TERMINAL_MISCONFIG = 78;

/**
 * `flume tick` exit code for the mount-dead failure class (v0.7 §4): the
 * chain module cannot load, the state root is missing, or its declaration is
 * invalid — no agent ran, nothing here is retryable by waiting. Sibling to
 * {@link EX_TERMINAL_MISCONFIG}, not a variant of it: terminal misconfiguration
 * is a chain that *did* resolve but declares an inconsistent world
 * (orphaned awake flags); mount-dead is no resolved chain at all.
 * sysexits.h `EX_UNAVAILABLE`. `superviseLoop` fail-fasts on a child exiting
 * with this code exactly as it does on {@link EX_TERMINAL_MISCONFIG} — a
 * mount-dead chain is exactly as dead next tick as this one, so continuing
 * would only burn the remaining `--max` ticks re-hitting the same wall.
 */
export const EX_MOUNT_DEAD = 69;

/**
 * Thrown by the strict `readPending()` — the reads that decide pickable work
 * (singleton/fanout tick start) or derive a rewrite (`commitPendingUpdate`) —
 * when `pending.json` exists but fails to parse. engineering.md "Loud or
 * nothing": a queue that never resolved must not read as an empty one, and
 * nothing downstream may derive a decision or a rewrite from it. `tick()`
 * catches this exactly where it catches chain-resolution failure and folds
 * it into the same {@link EX_MOUNT_DEAD} failed-outcome shape — a pending.json
 * no agent can parse is exactly as unusable next tick as this one.
 */
export class PendingParseFailure extends Error {
  readonly errors: readonly ParseError[];
  constructor(errors: readonly ParseError[]) {
    super(
      `pending.json failed to parse (${errors.length} error(s)): ` +
        errors.map((e) => `[${e.index}] ${e.path}: ${e.message}`).join("; "),
    );
    this.name = "PendingParseFailure";
    this.errors = errors;
  }
}

/**
 * Thrown in place of a plain {@link PendingParseFailure} when
 * `commitPendingUpdate`'s rewrite read hits one inside `runFanout` — the
 * ledger-rewrite drift `spec/loop.md` ("The tick verdict") names: by this
 * point the wave's cherry-picks and afterMerge gates already landed
 * `shippedTags` on trunk, so the verdict recording them must survive the
 * throw rather than vanish with it. `tick()`'s `PendingParseFailure` catch
 * checks for this subclass and folds `verdict` into the failed outcome it
 * returns; a plain `PendingParseFailure` from a decide-read (no agent ran,
 * nothing shipped) carries none, same as before. Not exported: thrown and
 * caught entirely within this module, unlike `PendingParseFailure` itself
 * (part of the gate-authoring API surface, `src/flumeApi.ts`) — this is the
 * one internal leg of that failure class, never something a chain's gate
 * needs to distinguish.
 */
class WaveLedgerParseFailure extends PendingParseFailure {
  readonly verdict: TickVerdict;
  constructor(errors: readonly ParseError[], verdict: TickVerdict) {
    super(errors);
    this.name = "WaveLedgerParseFailure";
    this.verdict = verdict;
  }
}

/**
 * Axis-C terminal misconfiguration (§3): the declared world is inconsistent —
 * deterministic, non-retryable, no agent ran. `kind` is a union open to
 * future Axis-C members; `"orphaned-awake"` (awake flags naming phases the
 * chain does not declare) is its founding member.
 */
export interface TerminalMisconfiguration {
  kind: "orphaned-awake";
  /** The awake-flag names the chain does not declare. Flags stay on disk. */
  phases: string[];
}

/**
 * Per-tick summary returned by `Dispatcher.tick()`. The loop inspects
 * `hibernated` to decide when to exit; `summary` is the one-liner the
 * dispatcher surfaces through the logger after each tick.
 */
export interface TickOutcome {
  hibernated: boolean;
  phaseName?: string;
  result?: TickResult;
  /**
   * True when the tick could not run at all — chain resolution threw and no
   * `chainLoadGate` reverted the producing commit (§3): the mount-dead
   * failure class (v0.7 §4). The `flume tick` process exits
   * {@link EX_MOUNT_DEAD}; the `flume loop` supervisor fail-fasts on it
   * (aborting the run) rather than proceeding to the next tick — a mount-dead
   * chain is exactly as dead next tick as this one. Distinct from
   * `hibernated` (clean stop) and from a no-commit tick (the agent ran but
   * produced or kept no commit).
   */
  failed?: boolean;
  /**
   * Set when chain resolution failed with the RELEASE-v0.7 §5 CJS-context
   * signature — a usage error (the host repo's package.json is missing
   * `"type": "module"`) with a concrete, nameable fix, not a mount-dead
   * chain nothing can retry. `flume tick` exits 2 (usage), never
   * {@link EX_MOUNT_DEAD}; sibling to `failed`, mutually exclusive with it —
   * this is the one chain-resolution failure that isn't `failed`.
   */
  usageError?: boolean;
  /**
   * For a no-commit tick (§6, widened by RELEASE-v0.10 §3): which of the
   * four causally-distinct modes produced no usable commit —
   *  - `gate-revert`      a commit was made then a gate reverted it,
   *  - `voluntary-bail`   the agent exited cleanly without committing
   *                       (a constraint it refused to cross),
   *  - `platform-preempt` the agent process failed for non-work reasons
   *                       (rate-limit, auth, timeout, dispatcher-killed) —
   *                       NOT a defect in the work,
   *  - `render-refused`   the prompt itself never resolved (an inline-exec
   *                       span failed) — the agent was never invoked at all.
   * Absent when the tick shipped a usable commit, hibernated, `failed`
   * (chain resolution threw), or ran no agent because nothing was pickable
   * (as opposed to `render-refused`, where an agent invocation was
   * attempted and the render itself is what failed). For a fanout wave it
   * is the representative cause when the whole wave shipped nothing
   * (precedence gate-revert > render-refused > platform-preempt >
   * voluntary-bail — §6's stated harm is platform failures masquerading as
   * agent failures, so platform-preempt outranks voluntary-bail in the wave
   * summary; render-refused is a real defect in the prompt/config, ranked
   * above the two non-defect classes); each entry's own mode is persisted
   * to its §5 prior-attempt record (the durable per-entry channel §6
   * mandates for telling voluntary-bail loops from platform-preempt runs
   * without reading session logs).
   */
  noCommit?: NoCommitMode;
  /**
   * RELEASE-v0.11 §5: mirrors {@link TickVerdict.tipMoved} — set when this
   * tick refused a commit because the ref moved out from under the tip it
   * recorded at tick start. A sibling fact to `noCommit` above, never a
   * fifth `NoCommitMode`: the tip-verify backstop is a harness-mechanical
   * refusal, not a cause the four causally-distinct modes classify.
   */
  tipMoved?: boolean;
  /**
   * RELEASE-v0.11 §8: set when this tick refused to invoke the agent
   * because `phase.shouldRun` returned `false` — a sibling fact to
   * `noCommit`/`tipMoved`, never a fifth `NoCommitMode`: the chain declined
   * the tick before rendering the prompt, so there is no agent termination
   * to classify and no ref race to blame. Distinguishable from
   * `voluntary-bail` (the agent ran and refused) and from `hibernated`
   * (nothing was awake) — a supervisor must be able to tell "the chain
   * declined" from "the agent bailed" without reading session logs.
   */
  declined?: boolean;
  /**
   * Axis-C terminal misconfiguration (§3) — sibling of `hibernated` /
   * `failed`, never a `NoCommitMode` member (no agent ran, no entry exists
   * to retry). Set when every awake flag names a phase the chain does not
   * declare. The flags are deliberately left on disk: clearing them would
   * convert the misconfiguration into a silent clean stop. `flume tick`
   * exits {@link EX_TERMINAL_MISCONFIG} when this is set.
   */
  terminal?: TerminalMisconfiguration;
  /**
   * §16 (RELEASE-v0.7): pre-tick worktree provisioning failures (sweep or
   * create) this fanout tick recorded, before any agent ran for the
   * affected entries. Distinct from `noCommit` — a provisioning failure
   * never reaches agent invocation, so it is not a §6 no-commit mode; a
   * tick can carry both (this entry's provisioning failed while its
   * siblings ran and shipped) or `provisionFailures` alone with
   * `noCommit` unset (every other entry shipped, so the wave itself
   * committed). Present only when the tick hit at least one; absent on a
   * singleton tick or a clean fanout wave.
   */
  provisionFailures?: ProvisionFailure[];
  /**
   * §16 (generalized past provisioning) — see {@link TickVerdict.mergeFailures}.
   * Present only when the tick hit at least one; absent on a singleton tick or
   * a fanout wave with no cherry-pick conflict.
   */
  mergeFailures?: MergeFailure[];
  /**
   * §16 (generalized past provisioning) — see {@link TickVerdict.gateFailures}.
   * Present only when the tick hit at least one; absent on a clean tick.
   */
  gateFailures?: GateFailure[];
  /**
   * v0.8 §5: this tick's unified facts artifact, present iff a phase
   * actually ran (same condition as `result`) — absent on `hibernated`,
   * `usageError`, or `terminal`. One exception on `failed`: a fanout wave
   * whose `commitPendingUpdate` rewrite hit a `PendingParseFailure`
   * (`WaveLedgerParseFailure`) still ran a phase and shipped tags onto trunk
   * before the ledger rewrite refused, so `failed: true` carries `verdict`
   * too in that one case — every other `failed` path (chain resolution, a
   * decide-read parse failure with no agent run) carries none. The CLI's
   * `tick` command persists this via `writeTickVerdict`; `Dispatcher.tick()`
   * itself never writes to disk, so a plain unit test calling it directly
   * gains no untracked side effect.
   */
  verdict?: TickVerdict;
  /** Phase names awake after this tick. */
  awakeAfter: string[];
  /** One-line summary suitable for log output. */
  summary: string;
}

/**
 * Runtime that wires baton + chain + agent + gates into one tick. Stateless
 * across ticks (everything it needs comes from disk). `tick()` runs exactly
 * one phase × one invocation (or N for fanout); `loop()` repeats until
 * hibernation or `maxTicks`.
 */
export class Dispatcher {
  private readonly opts: DispatcherOptions;
  private readonly baton: Baton;
  private readonly log: Logger;
  private readonly maxParallel: number;
  private readonly tickTimeoutMs: number | undefined;
  private readonly flumeDir: string;
  private readonly pendingPath: string;
  private readonly chainLoader: () => Promise<ChainModule>;
  /** Set when tick() loads the chain; composes pending parses (v0.8 §2). */
  private entryExtension: EntryExtension | undefined;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.flumeDir = opts.flumeDir ?? join(opts.repoRoot, ".flume");
    this.baton = new Baton(this.flumeDir);
    this.log = opts.log ?? consoleLogger;
    this.maxParallel = opts.maxParallel ?? 4;
    this.tickTimeoutMs = opts.tickTimeoutMs;
    this.pendingPath = join(this.flumeDir, "plan", "pending.json");
    this.chainLoader = opts.chainLoader ?? diskChainLoader(opts.configDir);
  }

  /** Run one phase × one tick. Returns hibernated outcome if nothing awake. */
  async tick(): Promise<TickOutcome> {
    const awake = this.baton.awake();

    // Disk is truth: this process resolves chain.ts exactly once, here. A
    // prior tick that rewrote chain.ts is governed by the new chain because
    // *this is a new process* (the supervisor spawned it) — not via any
    // in-process reload. The chain's optional `agent` export resolves with it.
    //
    // Engine resolution-failure fallback (§3): there is no in-process
    // "last-good chain" to retain — recovery is structural, not in-memory. A
    // chainLoadGate-guarded broken chain.ts is reverted by its producing
    // tick, so the next tick's fresh process reads the restored file. An
    // *unguarded* broken chain.ts has nothing to run: log loudly and return a
    // no-work failed outcome. The `flume tick` process exits {@link
    // EX_MOUNT_DEAD} (v0.7 §4); the `flume loop` supervisor aborts the run on
    // first occurrence rather than proceeding — a mount-dead chain is exactly
    // as dead next tick as this one, so it does not burn the remaining
    // `--max` ticks re-hitting the same wall.
    let chainModule: ChainModule;
    try {
      chainModule = await this.chainLoader();
    } catch (err) {
      if (err instanceof CjsContextLoadError) {
        // §5: a nameable usage fix, not a dead chain — `flume tick` exits 2
        // (usage), not EX_MOUNT_DEAD; distinct from `failed` below.
        this.log.error(`[flume] ${err.message}`);
        return {
          hibernated: false,
          usageError: true,
          awakeAfter: this.baton.awake(),
          summary: err.message,
        };
      }
      const msg = (err as Error).message;
      this.log.error(
        `[flume] chain resolution failed: ${msg}. This tick does no work. ` +
          `A chainLoadGate-guarded chain.ts is reverted by its producing ` +
          `tick; an unguarded broken chain.ts fails every tick until restored.`,
      );
      return {
        hibernated: false,
        failed: true,
        awakeAfter: this.baton.awake(),
        summary: `chain resolution failed: ${msg}; no work`,
      };
    }
    const chain = chainModule.chain;
    // Pending parses compose core + the chain's declared entry extension
    // (v0.8 §2); remembered here because readPending runs downstream of the
    // one place the chain is loaded.
    this.entryExtension = chain.entryExtension;
    // Foundations governor: a chain.ts `forkResolver` export overrides the
    // constructor default per tick, mirroring the `agent` override.
    const forkResolver = chainModule.forkResolver ?? this.opts.forkResolver;

    const phase = chain.phases.find((p) => awake.includes(p.name));

    if (!phase) {
      if (awake.length > 0) {
        // Axis C (§3): every awake flag names a phase the chain does not
        // declare. Not Axis B (nothing here is quiescent — the flags persist)
        // and not Axis A (no agent ran, nothing to retry). The flags stay on
        // disk so the human inspects, then `flume sleep <phase>` or fixes
        // the chain; clearing them would be a silent ack.
        const msg =
          `awake flags reference unknown phases: ${awake.join(", ")}; ` +
          `terminal misconfiguration (orphaned-awake), flags left on disk`;
        this.log.error(`[flume] ${msg}`);
        return {
          hibernated: false,
          terminal: { kind: "orphaned-awake", phases: awake },
          awakeAfter: awake,
          summary: msg,
        };
      }
      return {
        hibernated: true,
        awakeAfter: [],
        summary: "no phases awake; hibernating",
      };
    }

    // Per-phase delegation (§4): the phase's own agent is the innermost
    // scope of the chain-level override chain.
    const agent = phase.agent ?? chainModule.agent ?? this.opts.agent;

    this.log.info(`[flume] tick → ${phase.name} (${phase.concurrency})`);

    let phaseOutcome: PhaseTickOutcome;
    try {
      phaseOutcome =
        phase.concurrency === "singleton"
          ? await this.runSingleton(phase, agent, chain)
          : await this.runFanout(phase, agent, chain, forkResolver);
    } catch (err) {
      if (!(err instanceof PendingParseFailure)) throw err;
      // Same failure class as an unresolved chain (v0.7 §4): no agent ran
      // (singleton/fanout's decide-read refused before invoking one) or a
      // wave's shipped work landed on trunk but the rewrite that would clear
      // it from pending.json refused rather than deriving `[]` from a parse
      // it never trusted — either way this tick does no more work, and a
      // fresh process next tick reads the same unparseable file until a
      // human fixes it. The exit code is unchanged either way (EX_MOUNT_DEAD,
      // `failed: true`) — `WaveLedgerParseFailure`'s carried `verdict` only
      // adds the record of what the wave shipped before the ledger rewrite
      // refused; it never softens the refusal itself.
      this.log.error(`[flume] ${err.message}`);
      return {
        hibernated: false,
        failed: true,
        awakeAfter: this.baton.awake(),
        summary: err.message,
        ...(err instanceof WaveLedgerParseFailure
          ? { verdict: err.verdict }
          : {}),
      };
    }
    const {
      result,
      noCommit,
      tipMoved,
      declined,
      provisionFailures,
      mergeFailures,
      gateFailures,
      tags,
      mergeOutcomes,
    } = phaseOutcome;

    // §15: fold the already-computed no-commit classification into the
    // TickResult before handoff — a chain's `handoff` is the only place a
    // voluntary-bail wave can be distinguished from a genuine no-op.
    // `tipMoved` (RELEASE-v0.11 §5) does NOT fold in here: `TickResult`
    // (`src/Phase.ts`) carries no field for it — the fact lives on
    // `TickOutcome`/`TickVerdict` alone, read by a fresh next tick, never by
    // this same tick's synchronous `handoff`.
    const resultForHandoff: TickResult = noCommit
      ? { ...result, noCommit }
      : result;

    // Sleep this phase by default; handoff re-wakes if needed.
    this.baton.sleep(phase.name);
    const handoff = phase.handoff(resultForHandoff);
    const allowed = handoff.filter((n) => !chain.humanOnly.includes(n));
    for (const name of allowed) this.baton.wake(name);

    const summary = summarize(
      phase.name,
      result,
      allowed,
      noCommit,
      tipMoved,
      declined,
    );

    // v0.8 §5: the unified facts artifact — a pure value, built here so
    // `TickOutcome` carries everything the CLI's `tick` command needs to
    // persist it verbatim via `writeTickVerdict`. Building it is not itself
    // a disk write (the concern `writeTickVerdict`'s own doc names for
    // `Dispatcher.tick()` unit tests), so it costs the existing computed
    // fields (`summary` et al.) nothing extra.
    const verdict: TickVerdict = {
      phaseName: phase.name,
      tags: tags ?? [],
      committed: result.committed,
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(declined ? { declined } : {}),
      gateResults: [...result.gateResults] as TickVerdictGateResult[],
      shippedTags: [...result.shippedTags],
      mergeOutcomes: mergeOutcomes ?? [],
      ...(provisionFailures && provisionFailures.length > 0
        ? { provisionFailures }
        : {}),
      ...(mergeFailures && mergeFailures.length > 0 ? { mergeFailures } : {}),
      ...(gateFailures && gateFailures.length > 0 ? { gateFailures } : {}),
      summary,
    };

    return {
      hibernated: false,
      phaseName: phase.name,
      result: resultForHandoff,
      verdict,
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(declined ? { declined } : {}),
      ...(provisionFailures && provisionFailures.length > 0
        ? { provisionFailures }
        : {}),
      ...(mergeFailures && mergeFailures.length > 0 ? { mergeFailures } : {}),
      ...(gateFailures && gateFailures.length > 0 ? { gateFailures } : {}),
      awakeAfter: this.baton.awake(),
      summary,
    };
  }

  // ---------- singleton tick ----------

  private async runSingleton(
    phase: Phase,
    agent: Agent,
    chain: Chain,
  ): Promise<PhaseTickOutcome> {
    const repoRoot = this.opts.repoRoot;
    const preHead = await git.revParse(repoRoot);
    const pending = await this.readPending();

    const key = this.priorAttemptKey(phase);
    const prior = await this.readPriorAttempt(key);

    const noRunResult = (): TickResult => ({
      phaseName: phase.name,
      committed: false,
      gateResults: [],
      pendingAfter: pending,
      shippedTags: [],
      revertedTags: [],
    });

    // spec/worktrees.md "Singleton runs in a worktree": a singleton tick
    // provisions one worktree — a wave of one, keyed on the phase name
    // (there is no entry tag) — through the same machinery `runFanout` uses
    // per entry, so a provisioning wall costs this tick exactly what it
    // would cost a one-entry wave.
    try {
      await git.pruneWorktrees(repoRoot);
    } catch (err) {
      const message = (err as Error).message;
      this.log.warn(
        `[flume] ${phase.name}: worktree prune failed (${bound(message.trim(), MAX_FAILURE_SIGNATURE)}); continuing — worktree creation may still fail`,
      );
    }

    let wt: { path: string; branch: string; baseRef: string };
    try {
      wt = await this.createWorktree(phase.name, preHead);
    } catch (err) {
      const message = (err as Error).message;
      const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
      this.log.warn(
        `[flume] ${phase.name}: worktree provisioning failed (${signature}); no tick this cycle`,
      );
      return {
        result: noRunResult(),
        provisionFailures: [{ signature, message }],
      };
    }

    let extraEnv: Record<string, string> | undefined;
    if (phase.setupWorktree) {
      try {
        const r = await phase.setupWorktree({
          worktreePath: wt.path,
          repoRoot,
          entryTag: phase.name,
        });
        if (r && r.extraEnv) extraEnv = r.extraEnv;
      } catch (err) {
        const message = (err as Error).message;
        const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
        this.log.warn(
          `[flume] ${phase.name}: setupWorktree hook failed (${signature}); no tick this cycle`,
        );
        await this.teardownWorktreeInstance(phase, chain, repoRoot, wt, phase.name);
        return {
          result: noRunResult(),
          provisionFailures: [{ signature, message }],
        };
      }
    }

    const ctx: TickContext = { cwd: wt.path, flumeDir: this.flumeDir, pending };

    let declined = false;
    let noCommit: NoCommitMode | undefined;
    let tipMoved = false;
    let committed = false;
    let commitSha: string | undefined;
    const gateResults: GateResultEntry[] = [];
    // §16 (generalized): a singleton's own afterCommit/afterMerge gate
    // revert carries no entry tag (nothing to quarantine — see
    // GateFailure's doc), so it falls to the consecutive-failure backstop
    // alone. Same for a merge-stage failure — see MergeFailure's doc.
    const gateFailures: GateFailure[] = [];
    let mergeFailure: MergeFailure | undefined;

    // RELEASE-v0.11 §8: consulted before rendering the prompt or invoking
    // the agent — a chain can decline a tick without spending one. Sees the
    // same ctx `promptArgs` sees; undeclared `shouldRun` runs unconditionally.
    if (phase.shouldRun && !phase.shouldRun(ctx)) {
      this.log.info(`[flume] ${phase.name}: declined (shouldRun) — no invocation`);
      declined = true;
    } else {
      const args = phase.promptArgs?.(ctx) ?? {};

      let prompt: string | undefined;
      try {
        prompt = await renderPrompt({
          phase,
          flumeDir: this.flumeDir,
          promptFile: join(this.opts.configDir, phase.promptPath),
          cwd: wt.path,
          args,
          ...(prior ? { priorAttempt: prior } : {}),
        });
      } catch (err) {
        if (!(err instanceof InlineExecRenderError)) throw err;
        // RELEASE-v0.10 §3: an unresolved inline-exec span aborts the render
        // — the agent is never invoked. Distinct from voluntary-bail/
        // platform-preempt: no agent ran at all.
        await this.persistRenderRefused(key, phase.name, err);
        noCommit = "render-refused";
      }

      if (prompt !== undefined) {
        // Fresh read, not `preHead`: the worktree branched from it, so the
        // two agree unless `setupWorktree` itself committed something — same
        // defensive re-read `runFanoutEntry` takes for the identical reason.
        const preWtHead = await git.revParse(wt.path);
        const tickTimeoutMs =
          chain.supervisorPolicy?.tickTimeoutMs ?? this.tickTimeoutMs;
        const termination = await this.invokeAgent(
          phase,
          wt.path,
          prompt,
          agent,
          tickTimeoutMs,
          extraEnv,
        );
        const postWtHead = await git.revParse(wt.path);
        let wtCommitted = postWtHead !== preWtHead;

        if (wtCommitted) {
          // RELEASE-v0.11 §5 tip verify: the agent now commits on this
          // tick's own private worktree branch, same as a fanout entry — the
          // ancestry check, not parent equality (spec/worktrees.md
          // "Singleton runs in a worktree" retires the shared-ref leg).
          tipMoved = await this.checkTipMovedPerEntry(
            wt.path,
            phase.name,
            key,
            preWtHead,
            postWtHead,
          );
          if (tipMoved) wtCommitted = false;
        }

        if (wtCommitted) {
          const verdict = await this.runAfterCommitGates(
            phase,
            wt.path,
            postWtHead,
            undefined,
            preWtHead,
          );
          gateResults.push(...verdict.results);
          if (!verdict.ok) {
            const { gateFailure: gf } = await this.revertAfterCommitFailure(
              chain,
              wt.path,
              postWtHead,
              key,
              phase.name,
              undefined,
              verdict.failure!,
              verdict.touchedPaths,
            );
            noCommit = "gate-revert";
            gateFailures.push(gf);
            wtCommitted = false;
          }
        }

        if (wtCommitted) {
          // Carry the span back onto trunk through the same cherry-pick +
          // afterMerge machinery a one-entry wave uses (spec/worktrees.md
          // "Singleton runs in a worktree"). Trunk may have moved since
          // `preHead` — the operator's checkout is theirs at every moment of
          // a run now that the agent never touches it directly — so this
          // lands onto whatever trunk currently is; only a real conflict
          // refuses.
          const preCherry = await git.revParse(repoRoot);
          try {
            await git.cherryPickRange(repoRoot, preWtHead, postWtHead);
          } catch (err) {
            const message = (err as Error).message;
            this.log.warn(
              `[flume] cherry-pick failed for ${phase.name}: ${message}; commit stays on the worktree branch, retried next tick`,
            );
            await git.cherryPickAbort(repoRoot);
            mergeFailure = {
              signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
              message,
            };
          }

          if (!mergeFailure) {
            const mergedSha = await git.revParse(repoRoot);
            const afterMergeGates = phase.gates.filter((g) => g.when === "afterMerge");
            const commitTouchedPaths = await git.diffNameOnly(
              repoRoot,
              preCherry,
              mergedSha,
            );
            let entryFailure:
              | { gate: string; message: string; details?: string }
              | undefined;
            for (const gate of afterMergeGates) {
              const gr = await gate.run({
                cwd: repoRoot,
                repoRoot,
                flumeDir: this.flumeDir,
                configDir: this.opts.configDir,
                phaseName: phase.name,
                commitSha: mergedSha,
                touchedPaths: commitTouchedPaths,
                log: (l) => this.log.info(l),
              });
              gateResults.push({
                gate: gate.name,
                ok: gr.ok,
                message: gr.message,
                ...(gr.details ? { details: gr.details } : {}),
              });
              if (!gr.ok) {
                entryFailure = {
                  gate: gate.name,
                  message: gr.message,
                  ...(gr.details ? { details: gr.details } : {}),
                };
                break;
              }
            }

            if (entryFailure) {
              this.log.warn(
                `[flume] afterMerge gate '${entryFailure.gate}' failed for ${phase.name}; reverting`,
              );
              const record = await this.buildPriorAttempt(
                "afterMerge",
                entryFailure,
                repoRoot,
                mergedSha,
              );
              await this.writePriorAttempt(key, record);
              noCommit = "gate-revert";
              gateFailures.push({
                signature: gateFailureSignature(entryFailure),
                message: entryFailure.message,
              });
              // spec/loop.md "Tip verify", "dropping it must not take
              // bystanders": the primary checkout may hold an operator's
              // uncommitted work, so this reset carries keep-semantics —
              // never --hard — and a textual collision refuses loudly
              // rather than silently discarding either writer's content.
              // Caught here, not propagated: an uncaught throw would crash
              // the tick before this phase's own facts (the gate failure
              // above, teardown, the return below) were ever reached.
              try {
                await git.resetKeepTo(repoRoot, preCherry);
              } catch (err) {
                if (!(err instanceof git.ResetKeepRefusedError)) throw err;
                const message = `${err.message} — afterMerge-failed commit ${mergedSha} stays on trunk, unrevertable to ${preCherry}`;
                this.log.warn(
                  `[flume] ${phase.name}: revert of ${mergedSha.slice(0, 8)} back to ${preCherry.slice(0, 8)} refused (${err.message}); commit stays on trunk, left for the operator`,
                );
                gateFailures.push({
                  signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
                  message,
                });
              }
            } else {
              this.log.info(
                `[flume] cherry-picked ${phase.name} → ${mergedSha.slice(0, 8)}`,
              );
              committed = true;
              commitSha = mergedSha;
              // A clean ship clears the slot so the next tick starts with no
              // stale prior-attempt signal.
              await this.clearPriorAttempt(key);
            }
          }
        }

        if (!committed && !tipMoved && !noCommit && !mergeFailure) {
          // No commit landed and nothing else classified it: the agent's own
          // termination (§6). A clean exit that produced nothing is a
          // voluntary-bail; any process failure is a platform-preempt (not a
          // defect in the work).
          noCommit = await this.classifyNoCommit(key, termination);
          this.log.warn(`[flume] ${phase.name}: ${noCommit} (no commit)`);
        }
      }
    }

    await this.teardownWorktreeInstance(phase, chain, repoRoot, wt, phase.name);

    return {
      result: {
        phaseName: phase.name,
        committed,
        ...(commitSha ? { commitSha } : {}),
        gateResults,
        pendingAfter: await this.readPendingTolerant(),
        shippedTags: [],
        revertedTags: [],
      },
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(declined ? { declined } : {}),
      ...(gateFailures.length > 0 ? { gateFailures } : {}),
      ...(mergeFailure ? { mergeFailures: [mergeFailure] } : {}),
    };
  }

  /**
   * Wave-level §6 no-commit cause, only meaningful when the wave shipped
   * nothing usable — shared by the wave's normal-completion verdict and by
   * `WaveLedgerParseFailure`'s partial verdict (engineering.md "Derived
   * state is computed, never restated beside its source"), so a ledger
   * refusal reports the same cause a clean completion would have. Precedence
   * gate-revert > render-refused > platform-preempt > voluntary-bail:
   * gate-revert means work was produced and lost (highest signal);
   * render-refused (§3) is a real defect in the prompt/config, ranked above
   * the non-defect classes; platform-preempt outranks voluntary-bail so a
   * rate-limited wave is not misread as the agents bailing — §6's explicit
   * "platform failures masquerade as agent failures" harm.
   */
  private waveNoCommitCause(
    committedWave: boolean,
    perEntry: readonly { noCommit?: NoCommitMode }[],
    mergeReverted: readonly unknown[],
  ): NoCommitMode | undefined {
    if (committedWave) return undefined;
    const modes = new Set<NoCommitMode>(
      perEntry.flatMap((r) => (r.noCommit ? [r.noCommit] : [])),
    );
    // Per-entry afterMerge isolation (§7b) wrote a gate-revert §5 record for
    // each merge-reverted entry; reflect that in the wave-level cause.
    if (mergeReverted.length > 0) modes.add("gate-revert");
    return modes.has("gate-revert")
      ? "gate-revert"
      : modes.has("render-refused")
        ? "render-refused"
        : modes.has("platform-preempt")
          ? "platform-preempt"
          : modes.has("voluntary-bail")
            ? "voluntary-bail"
            : undefined;
  }

  // ---------- fanout tick ----------

  private async runFanout(
    phase: Phase,
    agent: Agent,
    chain: Chain,
    forkResolver?: (repoRoot: string) => (slug: string) => boolean,
  ): Promise<PhaseTickOutcome> {
    const repoRoot = this.opts.repoRoot;
    const preHead = await git.revParse(repoRoot);
    const pending = await this.readPending();

    // Foundations governor: resolve the per-tick fork predicate once, then let
    // it gate selection alongside `blockedBy`. Default: every fork resolved.
    const isForkResolved = forkResolver?.(repoRoot) ?? (() => true);
    // §16: a slug the supervisor quarantined earlier this run (its worktree
    // provisioning failed on a prior tick) is skipped here — `pending.json`
    // itself is untouched, so a fresh run/process retries it from scratch.
    const quarantinedSlugs = this.opts.quarantinedSlugs;
    // v0.8 §4: the environment facts this chain asserts, matched against
    // each entry's `requiresCapability` gate.
    const capabilities = new Set(chain.capabilities ?? []);
    const pickable = pending.filter(
      (e) =>
        isPickable(e, pending, isForkResolved, capabilities) &&
        !(quarantinedSlugs?.has(slugify(e.tag)) ?? false),
    );

    if (pickable.length === 0) {
      // No agent ran — not a no-commit *agent* tick, so no §6 classification.
      this.log.info(`[flume] ${phase.name}: nothing pickable`);
      return {
        result: {
          phaseName: phase.name,
          committed: false,
          gateResults: [],
          pendingAfter: pending,
          shippedTags: [],
          revertedTags: [],
        },
      };
    }

    const waveStart = Date.now();
    // Chain-overridable default (engine-boundary.md's policy-constant rule):
    // unlike quarantineScope/abortThreshold this needs no run-scoped binding
    // in the CLI — `chain` here is this tick's freshly-resolved chain
    // (tick() loads it once per process), so reading its declaration at the
    // point of use is already byte-identical to a per-run bind.
    const maxParallel = chain.supervisorPolicy?.maxParallel ?? this.maxParallel;
    const batches = partitionByFileOverlap(pickable, { maxParallel });
    const batch = batches[0]!;
    this.log.info(
      `[flume] ${phase.name}: fanout ${batch.length}/${pickable.length} pickable in batch 1/${batches.length}`,
    );

    // §16: a repo-level provisioning wall (prune itself fails — no single
    // entry to blame) is recorded, not thrown — the per-entry loop below
    // still gets a chance per slug (prune's own purpose is defensive: most
    // slugs are unaffected by one stale metadata entry), and the
    // consecutive-failure backstop is exactly the net for this "quarantine
    // can't isolate it" class.
    const provisionFailures: ProvisionFailure[] = [];
    try {
      // Recover from prior crashes / partial fanout failures: prune any
      // .git/worktrees/<slug>/ entries whose working directory has vanished.
      // Without this, half-broken metadata from one slug blocks `git worktree
      // add` for ALL subsequent slugs — git scans every worktree's metadata
      // during validation.
      await git.pruneWorktrees(repoRoot);
    } catch (err) {
      const message = (err as Error).message;
      const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
      provisionFailures.push({ signature, message });
      this.log.warn(
        `[flume] ${phase.name}: worktree prune failed (${signature}); continuing — per-entry provisioning may still fail`,
      );
    }

    // Serialize worktree creation (§4). `createWorktree` internally does
    // `git worktree remove` (stale-slug cleanup) then `git worktree add`,
    // both mutating the shared `.git/worktrees/` metadata dir — and git is
    // NOT concurrency-safe there: a sibling's `--force` remove can fail
    // another's add mid-validation. Run them one at a time, mirroring the
    // already-serialized pre-wave `pruneWorktrees` above. The per-entry
    // agent fanout below stays parallel — that is the expensive work, and
    // it does not touch `.git/worktrees/`.
    //
    // §16: a provisioning failure (sweep or create) is isolated to the
    // entry whose slug hit it — a held/EBUSY worktree dir on one entry must
    // not crash the whole batch when its siblings are perfectly pickable
    // (the ship-detection-declared-files-diff incident: 12/16 ticks burned
    // on one held slug while 6/7 other entries sat pickable). The failed
    // entry stays pending; `provisioned`/`worktrees` stay index-aligned for
    // everything downstream.
    const worktrees: Array<{ path: string; branch: string; baseRef: string }> =
      [];
    const provisioned: PendingEntry[] = [];
    for (const entry of batch) {
      try {
        worktrees.push(await this.createWorktree(entry.tag, preHead));
        provisioned.push(entry);
      } catch (err) {
        const message = (err as Error).message;
        const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
        provisionFailures.push({ tag: entry.tag, signature, message });
        this.log.warn(
          `[flume] ${phase.name}: worktree provisioning failed for ${entry.tag} (${signature}); entry stays pending, continuing with the remaining batch`,
        );
      }
    }

    // Optional per-phase setup (e.g. symlink node_modules / .env so gates
    // run). The return value MAY contribute extraEnv that the dispatcher
    // layers onto the agent invocation env (e.g. per-worktree DATABASE_URL
    // from a chain that provisioned an ephemeral DB at setup time).
    //
    // Isolated the same way `createWorktree` above isolates a per-entry
    // failure (§16): a hook throw for one entry must not reject the
    // `Promise.all` and crash the whole wave when its siblings' hooks
    // succeeded. The worktree this entry got from `createWorktree` still
    // exists and still needs teardown below, so `worktrees`/`provisioned`
    // stay untouched (and index-aligned to each other) for that loop; only
    // the set of entries handed to the agent excludes this one.
    const extraEnvByIndex: Array<Record<string, string> | undefined> =
      worktrees.map(() => undefined);
    const setupFailedIndices = new Set<number>();
    if (phase.setupWorktree) {
      const setupResults = await Promise.all(
        provisioned.map(async (entry, i) => {
          try {
            return await phase.setupWorktree!({
              worktreePath: worktrees[i]!.path,
              repoRoot,
              entryTag: entry.tag,
            });
          } catch (err) {
            const message = (err as Error).message;
            const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
            provisionFailures.push({ tag: entry.tag, signature, message });
            setupFailedIndices.add(i);
            this.log.warn(
              `[flume] ${phase.name}: setupWorktree hook failed for ${entry.tag} (${signature}); entry stays pending, continuing with the remaining batch`,
            );
            return undefined;
          }
        }),
      );
      for (let i = 0; i < setupResults.length; i++) {
        const r = setupResults[i];
        if (r && r.extraEnv) extraEnvByIndex[i] = r.extraEnv;
      }
    }

    // Run agent in each worktree concurrently — skipping any entry whose
    // setupWorktree hook threw above. Its worktree/branch still get torn
    // down in the cleanup loop below; it just never reaches the agent or
    // cherry-pick, so it stays pending like any other provisioning failure.
    const perEntry = await Promise.all(
      provisioned
        .map((entry, i) => ({ entry, i }))
        .filter(({ i }) => !setupFailedIndices.has(i))
        .map(({ entry, i }) =>
          this.runFanoutEntry(
            phase,
            entry,
            worktrees[i]!,
            agent,
            chain,
            extraEnvByIndex[i],
          ),
        ),
    );

    // Cherry-pick winners onto trunk in batch order, gating each at
    // afterMerge individually (§7b). The offending entry is the one whose
    // cherry-pick turns an afterMerge gate red — nothing else changed since
    // its pre-cherry-pick trunk — so revert *only* its commit (reset to that
    // point) and leave it pending. The N−1 clean siblings already on trunk
    // stay shipped; later siblings are evaluated against the trunk without
    // the reverted commit. No `hardResetTo(preHead)` whole-wave blast
    // radius: one flaky merge-time gate no longer kills N−1 clean commits.
    // Per-entry agent fanout (above) is unchanged — only the serial
    // post-fanout merge/gate/revert granularity changes.
    const afterMergeGates = phase.gates.filter((g) => g.when === "afterMerge");
    const shipped: PendingEntry[] = [];
    const mergeReverted: PendingEntry[] = [];
    // Entries whose afterMerge gate failed AND whose revert-off-trunk was
    // itself refused by a bystander collision (below) — never added to
    // `mergeReverted`, since that array's tags feed `revertedTags` and
    // claiming a revert that never happened would misreport the tree.
    // Counted alongside `mergeReverted` only for `waveNoCommitCause`'s
    // gate-revert classification, which cares that a gate failed, not
    // whether the follow-up reset landed.
    const revertRefused: PendingEntry[] = [];
    const mergeGateResults: GateResultEntry[] = [];
    // v0.8 §5: each provisioned entry's cherry-pick/merge fate, for this
    // wave's TickVerdict — the sole capture of what happened to each entry,
    // footprint included. `commitPendingUpdate` below reads a wave's
    // merge-failure footprints straight off these records (the same ones
    // `tick()` persists as `verdict.mergeOutcomes`) rather than a second,
    // independently-maintained observed-files map — "now generated from the
    // same verdict record rather than separate capture" (§5). An
    // afterCommit gate-revert or a plain no-commit entry never reaches
    // cherry-pick, so it gets an outcome here only when it carried a
    // captured footprint (§13).
    const mergeOutcomes: TickVerdictMergeOutcome[] = [];
    // §16 (generalized past provisioning): merge-stage and gate-stage
    // failures this wave recorded — sibling accounting to `provisionFailures`
    // above, fed to the same wave-level verdict for superviseLoop's quarantine
    // + consecutive-identical backstop to key off.
    const mergeFailures: MergeFailure[] = [];
    const gateFailures: GateFailure[] = [];
    let waveTipMoved = false;
    // RELEASE-v0.11 §8: mirrors `waveTipMoved` — a wave that declined at
    // least one entry sets this even when it also shipped (entries
    // `shouldRun` let through are unaffected by their siblings declining).
    let waveDeclined = false;

    for (const r of perEntry) {
      if (r.tipMoved) {
        waveTipMoved = true;
        // RELEASE-v0.11 §5 (per-entry leg): this entry's own ancestry check
        // refused before ever reaching cherry-pick — a real, dropped-work
        // fact, not silence a partial ship summary would otherwise paper
        // over (spec/loop.md "Tip verify"). Distinct from the wave-level
        // `tip-moved` outcome pushed below, which is the shared trunk racing
        // during this wave's own merge step.
        mergeOutcomes.push({
          tag: r.entry.tag,
          outcome: "dropped-work",
          ...(r.headSha ? { headSha: r.headSha } : {}),
        });
      }
      if (r.declined) waveDeclined = true;
      if (!r.committed || !r.commitSha || !r.spanBase) {
        // §13: an in-worktree afterCommit gate revert never reaches
        // cherry-pick, so it never touches trunk on its own — record its
        // captured footprint here so commitPendingUpdate below lands it on
        // trunk instead of it living only in the gitignored prior-attempt
        // record.
        if (r.footprint && r.footprint.length > 0) {
          mergeOutcomes.push({
            tag: r.entry.tag,
            outcome: "afterCommit-reverted",
            footprint: r.footprint,
            ...(r.headSha ? { headSha: r.headSha } : {}),
          });
        }
        if (r.gateFailure) gateFailures.push(r.gateFailure);
        continue;
      }

      // spec/loop.md "Tip verify", "Harness-driven commits carry no
      // expected-tip bookkeeping — the claim refuses, git arbitrates": no
      // sha comparison against a recorded expectation. A live claim on the
      // ref is a concurrent engine instance and refuses exactly as a moved
      // tip used to; absent one, whatever moved trunk was not an engine, and
      // the cherry-pick below lands onto whatever tip is current — git's own
      // conflict detection is the only content arbiter left.
      const foreignClaim = await this.liveForeignClaimPid(repoRoot);
      if (foreignClaim !== null) {
        this.log.warn(
          `[flume] ${phase.name}: tip claimed by pid ${foreignClaim}; refusing to cherry-pick ${r.entry.tag}, entry stays pending`,
        );
        waveTipMoved = true;
        mergeOutcomes.push({
          tag: r.entry.tag,
          outcome: "tip-moved",
          headSha: r.commitSha,
        });
        continue;
      }
      const preCherry = await git.revParse(repoRoot);
      try {
        // The per-entry leg's ancestry check already cleared the whole
        // `spanBase..commitSha` span as one completed entry — cherry-pick
        // the whole range, in order, not just the newest commit (spec/
        // loop.md "N commits are completion"). Equivalent to a single-sha
        // pick when the span holds exactly one commit.
        await git.cherryPickRange(repoRoot, r.spanBase, r.commitSha);
      } catch (err) {
        const message = (err as Error).message;
        this.log.warn(
          `[flume] cherry-pick failed for ${r.entry.tag}: ${message}; entry stays in pending`,
        );
        let footprint: string[] | undefined;
        try {
          footprint = await git.diffNameOnly(repoRoot, r.spanBase, r.commitSha);
        } catch {
          // Footprint capture is best-effort; the retry just partitions on
          // declared files as before.
        }
        // Abort the in-progress cherry-pick so the working tree is clean for
        // subsequent ticks. Without this, partially-applied changes block
        // the next plan tick (which can't run `pnpm install` etc. against a
        // dirty trunk) and require manual `git restore` intervention.
        await git.cherryPickAbort(repoRoot);
        mergeOutcomes.push({
          tag: r.entry.tag,
          outcome: "cherry-pick-conflict",
          ...(footprint ? { footprint } : {}),
          headSha: r.commitSha,
        });
        // §16 (generalized): a merge-stage failure — always entry-scoped, so
        // superviseLoop's quarantine leg can isolate it exactly like a
        // tagged provisioning failure.
        mergeFailures.push({
          tag: r.entry.tag,
          signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
          message,
        });
        continue;
      }
      const mergedSha = await git.revParse(repoRoot);

      // Gate this entry's merged commit. The first failing afterMerge gate
      // attributes the failure to *this* entry — it is the only delta
      // between `preCherry` and `mergedSha`, which now may span more than
      // one cherry-picked commit (spec/loop.md "N commits are completion") —
      // diffed as a range rather than `mergedSha`'s own single-commit show,
      // so an earlier commit in the span isn't missed.
      // Computed once per commit and shared across every gate this loop
      // runs, and reused below as the `afterMerge-reverted` footprint — same
      // dedup as runAfterCommitGates above.
      const commitTouchedPaths = await git.diffNameOnly(
        repoRoot,
        preCherry,
        mergedSha,
      );
      let entryFailure:
        | { gate: string; message: string; details?: string }
        | undefined;
      // `mergeGateResults` is a wave-cumulative accumulator (never reset
      // per entry — `allGateResults` below needs the whole wave's worth).
      // Capture this entry's own starting offset so `ShipContext.gateResults`
      // below can slice out just the results this entry's own afterMerge
      // loop appends, never an earlier sibling's (spec/pending.md "Ship
      // detection trusts the agent's own account").
      const entryMergeGateResultsStart = mergeGateResults.length;
      for (const gate of afterMergeGates) {
        const gr = await gate.run({
          cwd: repoRoot,
          repoRoot,
          flumeDir: this.flumeDir,
          configDir: this.opts.configDir,
          phaseName: phase.name,
          commitSha: mergedSha,
          touchedPaths: commitTouchedPaths,
          log: (l) => this.log.info(l),
        });
        mergeGateResults.push({
          gate: gate.name,
          ok: gr.ok,
          message: gr.message,
          ...(gr.details ? { details: gr.details } : {}),
        });
        if (!gr.ok) {
          entryFailure = {
            gate: gate.name,
            message: gr.message,
            ...(gr.details ? { details: gr.details } : {}),
          };
          break;
        }
      }

      if (entryFailure) {
        this.log.warn(
          `[flume] afterMerge gate '${entryFailure.gate}' failed for ${r.entry.tag}; reverting only that entry (clean siblings stay shipped)`,
        );
        // §5: afterMerge previously surfaced nothing to the agent — the
        // explicit anti-pattern this closes. Capture the digest while the
        // cherry-picked SHA is still reachable, then drop ONLY this entry's
        // commit (reset to the pre-cherry-pick trunk), not the wave. The
        // entry stays pending; its retry carries this prior-attempt block.
        const record = await this.buildPriorAttempt(
          "afterMerge",
          entryFailure,
          repoRoot,
          mergedSha,
        );
        await this.writePriorAttempt(
          this.priorAttemptKey(phase, r.entry),
          record,
        );
        gateFailures.push({
          tag: r.entry.tag,
          signature: gateFailureSignature(entryFailure),
          message: entryFailure.message,
        });
        // spec/loop.md "Tip verify", "dropping it must not take
        // bystanders": the primary checkout may hold an operator's
        // uncommitted work, so this reset carries keep-semantics — never
        // --hard — and a textual collision refuses loudly rather than
        // silently discarding either writer's content. Caught here, not
        // propagated: an uncaught throw would abort the whole wave loop
        // before `commitPendingUpdate` ever ran, dropping the ledger
        // rewrite for every sibling entry already cherry-picked and shipped
        // ahead of this one.
        try {
          await git.resetKeepTo(repoRoot, preCherry);
        } catch (err) {
          if (!(err instanceof git.ResetKeepRefusedError)) throw err;
          const message = `${err.message} — afterMerge-failed commit ${mergedSha} stays on trunk, unrevertable to ${preCherry}`;
          this.log.warn(
            `[flume] ${r.entry.tag}: revert of ${mergedSha.slice(0, 8)} back to ${preCherry.slice(0, 8)} refused (${err.message}); commit stays on trunk, left for the operator; other entries continue`,
          );
          revertRefused.push(r.entry);
          mergeOutcomes.push({
            tag: r.entry.tag,
            outcome: "afterMerge-revert-refused",
            footprint: commitTouchedPaths,
            headSha: mergedSha,
          });
          gateFailures.push({
            tag: r.entry.tag,
            signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
            message,
          });
          continue;
        }
        mergeReverted.push(r.entry);
        mergeOutcomes.push({
          tag: r.entry.tag,
          outcome: "afterMerge-reverted",
          footprint: commitTouchedPaths,
          headSha: mergedSha,
        });
        continue;
      }

      this.log.info(
        `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
      );

      // Landing on trunk isn't shipping, and the engine does not decide
      // which of the two this is. It reports facts; the chain interprets
      // (spec/pending.md "Ship detection trusts the agent's own account";
      // engine-boundary.md "Told, not inferred"). Undeclared means shipped.
      const shipVerdict =
        phase.shipped?.({
          entry: r.entry,
          mergedSha,
          touchedPaths: commitTouchedPaths,
          gateResults: [
            ...r.gateResults,
            ...mergeGateResults.slice(entryMergeGateResultsStart),
          ],
          worktreePath: r.worktreePath,
          repoRoot,
        }) ?? true;
      if (!shipVerdict) {
        this.log.warn(
          `[flume] ${r.entry.tag}: cherry-picked ${mergedSha.slice(0, 8)} but ${phase.name}.shipped returned false — commit stays on trunk, entry stays pending`,
        );
        mergeOutcomes.push({
          tag: r.entry.tag,
          outcome: "not-shipped",
          headSha: mergedSha,
        });
        continue;
      }

      shipped.push(r.entry);
      mergeOutcomes.push({
        tag: r.entry.tag,
        outcome: "merged",
        headSha: mergedSha,
      });
    }

    // Computed here — ahead of `commitPendingUpdate` below — rather than
    // after cleanup where the original single use lived, so a
    // `WaveLedgerParseFailure` thrown out of that call can report the same
    // gate results and committed-shape a clean completion would (read from
    // two sites, never restated).
    const allGateResults = perEntry
      .flatMap((r) => r.gateResults)
      .concat(mergeGateResults);
    const committedWave = shipped.length > 0;

    // Update pending.json — remove shipped entries, record merge-failure
    // footprints — as one harness commit. `commitPendingUpdate` derives the
    // footprints straight off `mergeOutcomes`, the same records this wave's
    // TickVerdict carries — no separate observed-files bookkeeping here.
    const footprintTags = mergeOutcomes
      .filter((m) => m.footprint && m.footprint.length > 0)
      .map((m) => m.tag);
    let chorSha: string | undefined;
    if (shipped.length > 0 || footprintTags.length > 0) {
      // Each shipped entry committed clean *and* passed its afterMerge gate
      // — clear any stale prior-attempt slot so its next plan/build cycle
      // starts with no false signal.
      for (const s of shipped) {
        await this.clearPriorAttempt(this.priorAttemptKey(phase, s));
      }
      const shippedTags = shipped.map((s) => s.tag);
      // The update can no-op (footprint already recorded, nothing shipped):
      // commitPendingUpdate then returns the pre-existing HEAD, which must
      // not be reported as this wave's commit.
      const preUpdate = await git.revParse(repoRoot);
      // commitPendingUpdate's rewrite read is the strict `readPending()`
      // (engineering.md "Loud or nothing"): if pending.json was corrupted by
      // something outside this tick in the window since the wave's
      // decide-read, the throw propagates past worktree cleanup below,
      // straight to `tick()`'s PendingParseFailure catch — already-shipped
      // commits stay on trunk (cherry-picked above), but the file itself is
      // never overwritten with a rewrite derived from `[]`. Surviving
      // worktrees are the accepted cost of refusing rather than proceeding;
      // the next `pruneWorktrees` call reclaims their metadata once a human
      // has fixed the file.
      let update: { sha: string; tipMoved: boolean };
      try {
        update = await this.commitPendingUpdate(shippedTags, mergeOutcomes);
      } catch (err) {
        if (!(err instanceof PendingParseFailure)) throw err;
        // spec/loop.md "The tick verdict — one facts artifact" drift (b):
        // this wave's shipped tags are already real (cherry-picked and
        // afterMerge-gated onto trunk above) — only the ledger rewrite
        // refused. A thrown error is the only channel left once
        // `commitPendingUpdate` never returns, so build the verdict this
        // wave already has the facts for and carry it on the error for
        // `tick()`'s `PendingParseFailure` catch to fold in, instead of
        // discarding it the way a plain re-throw would.
        const noCommit = this.waveNoCommitCause(
          committedWave,
          perEntry,
          [...mergeReverted, ...revertRefused],
        );
        const verdict: TickVerdict = {
          phaseName: phase.name,
          tags: provisioned.map((e) => e.tag),
          committed: committedWave,
          ...(noCommit ? { noCommit } : {}),
          ...(waveTipMoved ? { tipMoved: waveTipMoved } : {}),
          ...(waveDeclined ? { declined: waveDeclined } : {}),
          gateResults: allGateResults as TickVerdictGateResult[],
          shippedTags,
          mergeOutcomes,
          ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
          ...(mergeFailures.length > 0 ? { mergeFailures } : {}),
          ...(gateFailures.length > 0 ? { gateFailures } : {}),
          summary:
            shippedTags.length > 0
              ? `${phase.name} shipped ${shippedTags.join(", ")} — pending-ledger rewrite refused (${err.message})`
              : `${phase.name}: pending-ledger rewrite refused (${err.message})`,
        };
        throw new WaveLedgerParseFailure(err.errors, verdict);
      }
      const updSha = update.sha;
      if (updSha !== preUpdate) chorSha = updSha;
      if (update.tipMoved) {
        waveTipMoved = true;
        this.log.warn(
          `[flume] ${phase.name}: tip claimed before the pending-ledger commit; pending.json left untouched — shipped entries already on trunk stay shipped`,
        );
      } else {
        this.log.info(
          shippedTags.length > 0
            ? updSha === preUpdate
              ? `[flume] shipped ${shippedTags.join(", ")}; pending updated on disk, no chore commit (dock outside repo)`
              : `[flume] ship commit ${updSha.slice(0, 8)}: ${shippedTags.join(", ")}`
            : updSha === preUpdate
              ? `[flume] footprint already recorded, no commit: ${footprintTags.join(", ")}`
              : `[flume] footprint commit ${updSha.slice(0, 8)}: ${footprintTags.join(", ")}`,
        );
      }
    }

    // Cleanup worktrees. Best-effort teardown fires before git.removeWorktree
    // so chain-provisioned ephemera (per-worktree DB, scratch lease, etc.)
    // releases while the worktree path still exists. Teardown failures are
    // logged but do not block worktree removal — leaks are recoverable, a
    // stuck worktree is not. Friction harvest (§4) runs in the same
    // best-effort slot, immediately before removal — the last point the
    // worktree-local mirror is still readable.
    let cleaned = 0;
    // §7: a worktree whose directory survives even the fallback removal is
    // reported once for the whole wave, not once per worktree — a locked
    // node_modules on one entry shouldn't produce N identical log lines.
    const survivingPaths: string[] = [];
    // Serialize teardown for the same reason as setup (§4): N concurrent
    // `git worktree remove --force` calls race the shared `.git/worktrees/`
    // dir. The chain's `teardownWorktree` hook and branch deletion ride the
    // same serial loop — teardown is off the critical path, so a simple
    // sequential walk beats interleaving the git-mutating step out alone.
    for (let i = 0; i < worktrees.length; i++) {
      const wt = worktrees[i]!;
      const tag = provisioned[i]!.tag;
      const ok = await this.teardownWorktreeInstance(phase, chain, repoRoot, wt, tag);
      if (ok) cleaned++;
      else survivingPaths.push(wt.path);
    }
    this.log.info(
      `[flume] ${phase.name}: cleaned ${cleaned}/${worktrees.length} worktree(s)`,
    );
    if (survivingPaths.length > 0) {
      this.log.warn(
        `[flume] ${phase.name}: ${survivingPaths.length} worktree(s) survived removal (fallback exhausted): ${survivingPaths.join(", ")}`,
      );
    }
    this.log.info(
      `[flume] ${phase.name}: wave done in ${Date.now() - waveStart}ms`,
    );

    // Wave-level §6 cause, only when the wave shipped nothing usable —
    // `allGateResults`/`committedWave` were already computed above, ahead of
    // `commitPendingUpdate`, so `WaveLedgerParseFailure`'s partial verdict
    // could read them too.
    const waveNoCommit = this.waveNoCommitCause(
      committedWave,
      perEntry,
      [...mergeReverted, ...revertRefused],
    );

    return {
      result: {
        phaseName: phase.name,
        committed: committedWave,
        ...(chorSha ? { commitSha: chorSha } : {}),
        gateResults: allGateResults,
        pendingAfter: await this.readPendingTolerant(),
        shippedTags: shipped.map((s) => s.tag),
        revertedTags: mergeReverted.map((e) => e.tag),
      },
      ...(waveNoCommit ? { noCommit: waveNoCommit } : {}),
      ...(waveTipMoved ? { tipMoved: waveTipMoved } : {}),
      ...(waveDeclined ? { declined: waveDeclined } : {}),
      ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
      ...(mergeFailures.length > 0 ? { mergeFailures } : {}),
      ...(gateFailures.length > 0 ? { gateFailures } : {}),
      tags: provisioned.map((e) => e.tag),
      mergeOutcomes,
    };
  }

  // ---------- per-entry fanout ----------

  private async runFanoutEntry(
    phase: Phase,
    entry: PendingEntry,
    wt: { path: string; branch: string },
    agent: Agent,
    chain: Chain,
    extraEnv?: Record<string, string>,
  ): Promise<{
    entry: PendingEntry;
    committed: boolean;
    commitSha?: string;
    /**
     * RELEASE-v0.11 §5 (per-entry leg): the tip this entry's worktree was
     * provisioned from — the ancestry check's recorded base, and the range
     * start the wave loop cherry-picks and diffs from (`base..commitSha`,
     * spec/loop.md "N commits are completion"). Set alongside `commitSha`
     * on every path that reaches a commit; absent otherwise.
     */
    spanBase?: string;
    gateResults: GateResultEntry[];
    /** §6 mode when this entry produced no usable commit; absent when it shipped. */
    noCommit?: NoCommitMode;
    /** RELEASE-v0.11 §5: sibling to `noCommit`, set when this entry's own worktree commit landed on a moved tip. */
    tipMoved?: boolean;
    /** RELEASE-v0.11 §8: sibling to `noCommit`/`tipMoved`, set when `phase.shouldRun` declined this entry before the agent was invoked. */
    declined?: boolean;
    /**
     * The worktree-branch commit this entry made and then lost before ever
     * reaching cherry-pick — the tip-verify ancestry check's own observed
     * HEAD (`tipMoved`) or the commit `revertAfterCommitFailure` dropped
     * (`noCommit: "gate-revert"`). The wave loop's `dropped-work`/
     * `afterCommit-reverted` mergeOutcomes read this for `headSha` since
     * `commitSha` above is reserved for a span that actually reached
     * cherry-pick. Absent on every other path.
     */
    headSha?: string;
    /** This entry's worktree, still on disk when the merge loop classifies it — `ShipContext.worktreePath`. */
    worktreePath: string;
    /**
     * §13 (RELEASE-v0.7): the reverted commit's actual touched paths, captured
     * before `dropLastCommit` discards it — set only on an in-worktree
     * `afterCommit` gate revert, so the wave loop can feed it into `observed`
     * the same way an `afterMerge` failure's footprint is fed in.
     */
    footprint?: string[];
    /**
     * §16 (generalized): set only alongside a `noCommit: "gate-revert"`
     * afterCommit revert — the wave loop folds this entry-tagged record into
     * its own `gateFailures` the same way it folds `footprint` into
     * `mergeOutcomes`.
     */
    gateFailure?: GateFailure;
    /**
     * Set only when this entry's own commit landed and passed its
     * afterCommit gates — the wave loop's ship-classification site (spec/
     * pending.md "Ship detection trusts the agent's own account", ruling
     * 2026-08-03) reads it instead of diffing the commit against
     * `declaredPaths(entry)`. Absent on every other return path: a no-commit
     * or gate-reverted entry never reaches cherry-pick, so there is nothing
     * for ship classification to consult.
     */
    termination?: AgentTermination;
  }> {
    // The prior-attempt record lives at the repo root (not this fresh
    // worktree), keyed by the entry tag — so a reverted attempt's record
    // survives into the next tick's brand-new worktree.
    const key = this.priorAttemptKey(phase, entry);
    const prior = await this.readPriorAttempt(key);

    const ctx: TickContext = {
      cwd: wt.path,
      flumeDir: this.flumeDir,
      assignedEntry: entry,
    };

    // RELEASE-v0.11 §8: same seam as the singleton callsite, scoped to this
    // entry — sees the same ctx `promptArgs` sees.
    if (phase.shouldRun && !phase.shouldRun(ctx)) {
      this.log.info(
        `[flume] ${entry.tag}: declined (shouldRun) — no invocation`,
      );
      return { entry, committed: false, gateResults: [], declined: true, worktreePath: wt.path };
    }

    const args = phase.promptArgs?.(ctx) ?? {};

    let prompt: string;
    try {
      prompt = await renderPrompt({
        phase,
        flumeDir: this.flumeDir,
        promptFile: join(this.opts.configDir, phase.promptPath),
        cwd: wt.path,
        args,
        assignedEntry: entry,
        ...(prior ? { priorAttempt: prior } : {}),
      });
    } catch (err) {
      if (!(err instanceof InlineExecRenderError)) throw err;
      // RELEASE-v0.10 §3: same abort as the singleton callsite, scoped to
      // this entry — the agent for this entry is never invoked.
      await this.persistRenderRefused(key, entry.tag, err);
      return { entry, committed: false, gateResults: [], noCommit: "render-refused", worktreePath: wt.path };
    }

    const preHead = await git.revParse(wt.path);
    const tickTimeoutMs =
      chain.supervisorPolicy?.tickTimeoutMs ?? this.tickTimeoutMs;
    const termination = await this.invokeAgent(
      phase,
      wt.path,
      prompt,
      agent,
      tickTimeoutMs,
      extraEnv,
    );
    const postHead = await git.revParse(wt.path);
    let committed = postHead !== preHead;

    if (committed) {
      // RELEASE-v0.11 §5 tip verify, per-entry leg (spec/loop.md "Tip
      // verify"): the agent commits directly in this worktree, so verify
      // after the fact — but ancestry, not parent equality. The worktree's
      // own branch is private to this entry/tick, so an agent that commits,
      // keeps working, and commits again has produced a completed multi-
      // commit entry, not interference; only a base that is no longer an
      // ancestor of the observed HEAD means something reset or rewrote the
      // branch out from under the agent.
      const tipMoved = await this.checkTipMovedPerEntry(
        wt.path,
        entry.tag,
        key,
        preHead,
        postHead,
      );
      if (tipMoved) {
        return {
          entry,
          committed: false,
          gateResults: [],
          tipMoved: true,
          worktreePath: wt.path,
          headSha: postHead,
        };
      }
    }

    const gateResults: GateResultEntry[] = [];
    if (!committed) {
      // No commit, no gate: classify per-entry and persist the matching §5
      // record (the durable per-entry channel §6 names — corpus-config-example
      // bailed at the same writablePaths wall five sessions running; that
      // must be legible without reading session logs).
      const mode = await this.classifyNoCommit(key, termination);
      this.log.warn(`[flume] ${entry.tag}: ${mode} (no commit)`);
      return { entry, committed: false, gateResults, noCommit: mode, worktreePath: wt.path };
    }

    // The ancestry check above cleared the whole base..postHead span as one
    // completed entry (spec/loop.md "N commits are completion") — gate the
    // span's cumulative footprint, not just postHead's own single-commit
    // diff, so a gate can't miss what an earlier commit in the span touched.
    const verdict = await this.runAfterCommitGates(
      phase,
      wt.path,
      postHead,
      entry,
      preHead,
    );
    gateResults.push(...verdict.results);
    if (!verdict.ok) {
      // §13: this revert never reaches cherry-pick, so it's the only chance
      // to capture what the commit actually touched — runAfterCommitGates
      // already computed this for its gate loop (engineering.md "The fix
      // lands at the mechanism"), so reuse it instead of re-deriving via a
      // second `git show --name-only` before dropLastCommit discards the
      // evidence.
      const { footprint, gateFailure } = await this.revertAfterCommitFailure(
        chain,
        wt.path,
        postHead,
        key,
        entry.tag,
        entry.tag,
        verdict.failure!,
        verdict.touchedPaths,
      );
      return {
        entry,
        committed: false,
        gateResults,
        noCommit: "gate-revert",
        worktreePath: wt.path,
        footprint,
        gateFailure,
        headSha: postHead,
      };
    }

    return {
      entry,
      committed: true,
      commitSha: postHead,
      spanBase: preHead,
      gateResults,
      termination,
      worktreePath: wt.path,
    };
  }

  // ---------- helpers ----------

  /**
   * spec/loop.md "Tip verify", "Harness-driven commits carry no expected-tip
   * bookkeeping — the claim refuses, git arbitrates": the wave's two
   * harness-driven commit sites (the per-entry cherry-pick, and
   * `commitPendingUpdate`'s ledger commit) ask this instead of comparing an
   * expected sha. A live claim on the ref HEAD currently resolves to is a
   * concurrent engine instance — the one interference no cherry-pick/conflict
   * check can catch on its own, since two engines can each cherry-pick a
   * distinct, individually-clean commit onto the same tip. No live claim
   * means whatever moved the ref was not an engine (`spec/loop.md`: "an
   * engine instance always holds the claim, an operator never does"), so the
   * caller proceeds and lets git's own conflict detection arbitrate content.
   * A detached HEAD (untracked here — `flume tick`/`flume loop` both refuse
   * it before any tick runs) reads as no claim, never a thrown error. A live
   * claim matching `opts.ownTipClaimPid` is this run's own — not foreign —
   * per that option's doc.
   */
  private async liveForeignClaimPid(cwd: string): Promise<number | null> {
    const ref = await git.currentRefPath(cwd);
    if (ref.kind !== "ref") return null;
    const commonDir = await git.gitCommonDir(cwd);
    const claimPath = git.tipClaimPath(commonDir, ref.path);
    const holder = await git.liveTipClaimPid(claimPath);
    if (holder === null || holder === this.opts.ownTipClaimPid) return null;
    return holder;
  }

  /**
   * RELEASE-v0.11 §5 tip verify's guarded revert, for a commit the agent
   * made itself. `expectedSha` is `postHead`, the commit this call's own
   * caller just observed.
   *
   * Mirrors `git.dropLastCommit`'s guarded-revert idiom — §5 cites it as its
   * own precedent — reconfirming the tip is still `expectedSha` immediately
   * before resetting, so a second race (the ref moving again in the gap
   * between observing `postHead` and reverting it) refuses loudly rather
   * than silently dropping a commit this call never observed at the tip.
   * Soft, not hard, unlike `dropLastCommit`: the agent's work was never at
   * fault, so it survives as uncommitted changes (§5 "agent output stays on
   * disk") rather than being discarded.
   *
   * `resetToSha` is always the recorded base — every worktree branch (a
   * fanout entry's, or, since spec/worktrees.md "Singleton runs in a
   * worktree", a singleton phase's own) is a private ref with exactly one
   * legitimate writer, so the target is always that branch's own start
   * point. The trunk's former shared-ref ambiguity — which needed a
   * commit-*count* revert because the dispatcher couldn't tell its own
   * commits from an interleaved operator's — no longer has a caller: a
   * singleton tick's agent now commits on a private branch same as a fanout
   * entry's, never on the trunk directly.
   */
  private async revertTipMovedCommit(
    cwd: string,
    expectedSha: string,
    resetToSha: string,
  ): Promise<void> {
    const currentTip = await git.revParse(cwd);
    if (currentTip !== expectedSha) {
      throw new Error(
        `tip-verify revert refused: current tip ${currentTip} does not ` +
          `match expected ${expectedSha} — this call did not observe the ` +
          `commit at the current tip, refusing to reset`,
      );
    }
    await git.softResetTo(cwd, resetToSha);
  }

  /**
   * RELEASE-v0.11 §5 tip verify (spec/loop.md "Tip verify", "Per-entry leg —
   * private ref, ancestry, N commits are completion"). Every worktree branch
   * — a fanout entry's or a singleton phase's own (spec/worktrees.md
   * "Singleton runs in a worktree") — has exactly one legitimate writer:
   * this tick's agent. The check is ancestry — the recorded base must be an
   * ancestor of the observed HEAD — so a multi-commit span never trips this
   * on its own account; the caller runs the whole span's gates and
   * cherry-picks it like a single-commit entry once this returns `false`.
   *
   * Refusal fires only when the base is *not* an ancestor of `postHead`,
   * which on a private branch means something reset or rewrote it out from
   * under the agent. Both the log line and the persisted record name
   * `postHead` itself as the observed tip — never `postHead`'s parent alone,
   * which would read the agent's own work as the intruder and leave the top
   * commit undiscoverable (the flume 0.10.1 field trace this split closes).
   */
  private async checkTipMovedPerEntry(
    cwd: string,
    label: string,
    key: string,
    preHead: string,
    postHead: string,
  ): Promise<boolean> {
    const ancestor = await git.isAncestor(cwd, preHead, postHead);
    if (ancestor) return false;
    await this.revertTipMovedCommit(cwd, postHead, preHead);
    await this.writePriorAttempt(key, buildTipMoved(preHead, postHead));
    this.log.warn(
      `[flume] ${label}: tip moved (no commit) — expected ${preHead}, found ${postHead}`,
    );
    return true;
  }

  private async invokeAgent(
    phase: Phase,
    cwd: string,
    prompt: string,
    agent: Agent,
    tickTimeoutMs: number | undefined,
    extraEnv?: Record<string, string>,
  ): Promise<AgentTermination> {
    try {
      const result = await agent.invoke({
        cwd,
        prompt,
        ...(tickTimeoutMs !== undefined ? { timeoutMs: tickTimeoutMs } : {}),
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
        ...(extraEnv ? { extraEnv } : {}),
      });
      if (result.exitCode !== 0) {
        // A non-zero exit is a process failure, not a deliberate bail: crash,
        // OOM/SIGKILL, auth, or rate-limit surfaced as a non-zero code. §6
        // platform-preempt — not a defect in the work.
        const failureClass = `agent process exited with code ${result.exitCode} (non-work failure: crash, kill, auth, or rate-limit surfaced as a non-zero exit)`;
        this.log.warn(`[flume] ${phase.name}: ${failureClass}`);
        return { kind: "process-failure", failureClass };
      }
      // Clean exit. `result.stdout` is the full captured transcript; the
      // agent's final message — where a writablePaths/Rule-0/spec bail names
      // the constraint it refused — lives at its tail.
      return { kind: "clean", stdout: result.stdout };
    } catch (err) {
      // Swallow abort/timeout/spawn errors so a single bad invocation doesn't
      // tear down the loop. The post-invocation `git rev-parse` still runs,
      // so any commit the agent managed to make before aborting is honored;
      // otherwise the phase falls through with `committed: false`. Either way
      // this is a §6 platform-preempt — not a defect in the work.
      const e = err as Error & { name?: string; code?: string };
      const failureClass =
        e.name === "AbortError" || e.code === "ABORT_ERR"
          ? "agent process aborted (per-tick timeout or dispatcher signal)"
          : `agent process error before exit: ${e.message}`;
      this.log.warn(`[flume] ${phase.name}: ${failureClass}`);
      return { kind: "process-failure", failureClass };
    }
  }

  private async runAfterCommitGates(
    phase: Phase,
    cwd: string,
    commitSha: string,
    assignedEntry?: PendingEntry,
    /**
     * RELEASE-v0.11 §5: when set, touched paths are the cumulative
     * `spanBase..commitSha` diff rather than `commitSha`'s own single-commit
     * diff — the whole-span gate (spec/loop.md "N commits are completion").
     * Every caller now passes it — both a fanout entry's worktree branch and
     * a singleton phase's own (spec/worktrees.md "Singleton runs in a
     * worktree") are private refs whose ancestry check clears a multi-commit
     * span as one completed tick.
     */
    spanBase?: string,
  ): Promise<{
    ok: boolean;
    /** First failing gate, structured so callers can persist a §5 record. */
    failure?: { gate: string; message: string; details?: string };
    results: GateResultEntry[];
    /** The commit's touched paths, already computed for the gate loop below —
     * exposed so callers don't re-derive via a second `git show --name-only`
     * for the same commit (engineering.md "The fix lands at the mechanism"). */
    touchedPaths: string[];
  }> {
    // Entry-scoped write guard (spec/pending.md, "The entry-scoped write
    // guard is opt-in, and off by default"): narrowing to the assigned
    // entry's declared files ∪ the phase's channel globs is a chain
    // declaration (`phase.scopeWritesToEntry`), not automatic on every
    // scoped tick. Undeclared, a fanout tick's allowance is byte-identical
    // to a singleton tick's — `writablePaths` alone. `observedFiles` is
    // deliberately excluded even when scoping is on — it feeds the
    // partition, not the write allowance.
    const gates: Gate[] = [
      ...phase.gates.filter((g) => g.when === "afterCommit"),
      writablePathsGate(
        phase.writablePaths,
        assignedEntry && phase.scopeWritesToEntry
          ? {
              entryPaths: declaredPaths(assignedEntry),
              channelPaths: phase.entryChannelPaths ?? [],
            }
          : undefined,
      ),
    ];
    // Computed once per commit and shared across every gate this loop runs —
    // chainLoadGate and writablePathsGate read it off the context instead of
    // each shelling out its own `git show --name-only` for the same commit
    // (engineering.md "The fix lands at the mechanism").
    const commitTouchedPaths = spanBase
      ? await git.diffNameOnly(cwd, spanBase, commitSha)
      : await git.showNameOnly(cwd, commitSha);
    // `cwd` here is the fanout worktree (or a singleton's own worktree,
    // spec/worktrees.md "Singleton runs in a worktree") — a fresh checkout
    // that holds only tracked files at the same relative layout as the
    // primary checkout. `this.opts.configDir` is resolved against the
    // primary checkout, so it is rebased onto `cwd` at its own relative
    // offset rather than passed through verbatim, or a relocated configDir
    // would point a gate at the wrong tree entirely.
    const configDir = join(
      cwd,
      relative(this.opts.repoRoot, this.opts.configDir),
    );
    const results: GateResultEntry[] = [];
    for (const gate of gates) {
      const r: GateResult = await gate.run({
        cwd,
        repoRoot: cwd,
        flumeDir: this.flumeDir,
        configDir,
        phaseName: phase.name,
        commitSha,
        touchedPaths: commitTouchedPaths,
        log: (l) => this.log.info(l),
      });
      results.push({
        gate: gate.name,
        ok: r.ok,
        message: r.message,
        ...(r.details ? { details: r.details } : {}),
      });
      if (!r.ok) {
        if (r.details) this.log.warn(r.details);
        return {
          ok: false,
          failure: {
            gate: gate.name,
            message: r.message,
            ...(r.details ? { details: r.details } : {}),
          },
          results,
          touchedPaths: commitTouchedPaths,
        };
      }
    }
    return { ok: true, results, touchedPaths: commitTouchedPaths };
  }

  /**
   * The one `afterCommit`-revert path (spec/worktrees.md "Reverted prose
   * survives the reset"): every afterCommit gate revert — a fanout entry's
   * worktree commit or, since singleton moved into a worktree too (spec/
   * worktrees.md "Singleton runs in a worktree"), a singleton phase's own —
   * snapshots the commit's files before dropping it (§8) and writes the
   * operator's revert note (§5), whichever worktree it ran in. The former
   * asymmetry — snapshot singleton-only, note fanout-only — collapsed with
   * the paths themselves once both concurrencies commit to a private branch
   * a tick tears down at the end.
   *
   * `label` names the entry tag or the phase name — both the revert note's
   * filename and the log line use it. `gateFailureTag` is `label` for a
   * fanout entry and `undefined` for a singleton phase's own revert (no
   * entry to quarantine — {@link GateFailure.tag}'s doc).
   */
  private async revertAfterCommitFailure(
    chain: Chain,
    cwd: string,
    sha: string,
    key: string,
    label: string,
    gateFailureTag: string | undefined,
    failure: { gate: string; message: string; details?: string },
    touchedPaths: string[],
  ): Promise<{ footprint: string[]; gateFailure: GateFailure }> {
    const record = await this.buildPriorAttempt("afterCommit", failure, cwd, sha);
    await this.writeRevertNote(chain, cwd, sha, label, failure);
    await this.snapshotRevertedFiles(cwd, sha, key);
    await git.dropLastCommit(cwd, sha);
    await this.writePriorAttempt(key, record);
    this.log.warn(`[flume] ${label}: commit reverted (${failure.message})`);
    return {
      footprint: touchedPaths,
      gateFailure: {
        ...(gateFailureTag ? { tag: gateFailureTag } : {}),
        signature: gateFailureSignature(failure),
        message: failure.message,
      },
    };
  }

  /**
   * §4 (RELEASE-v0.6.2): before a fanout worktree is torn down, move every
   * file its declared friction channel holds *that is new relative to the
   * worktree's own base commit* into the primary friction dir, prefixed
   * `<tag>--<stamp>--` for provenance and collision-freedom — the stamp
   * (same `Date.toISOString()`-minus-punctuation idiom as `writeRevertNote`)
   * means a retried entry whose agent reuses the same source filename lands
   * beside the earlier note instead of silently replacing it, since neither
   * `rename` nor the `EXDEV` fallback's `copyFile` refuse an existing
   * destination. Harvest is harness code crossing the worktree boundary (the
   * sessions precedent), not an agent write — worktree agents still only
   * ever write under their own `$PWD`.
   *
   * The base-delta bound (spec/worktrees.md "Teardown harvest — the
   * delivery guarantee") is what keeps the relay convergent: a file already
   * present at `baseRef` for this path arrived via the checkout itself, not
   * this tick's agent, and re-harvesting it would re-deposit the same note
   * once per worktree that inherits it. `git ls-tree` at `baseRef` is the
   * existence probe — content is irrelevant, only whether the path was
   * already there.
   *
   * Undeclared `chain.friction` — no-op. A relocated state root (`flumeDir`
   * outside the repo tree) has no worktree-local mirror to harvest from —
   * also a no-op, per §4's stated scope. Any failure here (missing dir,
   * unreadable file, locked handle) is logged and swallowed: harvest must
   * never abort the wave, and whatever it can't move is left for §7's
   * removal-fallback sweep to surface.
   */
  private async harvestFriction(
    chain: Chain,
    worktreePath: string,
    tag: string,
    baseRef: string,
  ): Promise<void> {
    if (chain.friction === undefined) return;
    const stateRootRel = relative(this.opts.repoRoot, this.flumeDir);
    const relocated =
      stateRootRel === ".." ||
      stateRootRel.startsWith(`..${sep}`) ||
      isAbsolute(stateRootRel);
    if (relocated) return;

    const mirrorDir = join(worktreePath, stateRootRel, chain.friction);
    let entries: Dirent[];
    try {
      // win32 MAX_PATH (`.claude/rules/platform-facts.md`): mirrorDir nests
      // a worktree path under chain.friction. namespacedJoin (src/paths.ts)
      // is the shared idiom — same as writeRevertNote below.
      entries = await readdir(namespacedJoin(mirrorDir), {
        withFileTypes: true,
      });
    } catch (err) {
      // Absent dir (no friction written this tick) is expected and silent.
      // Anything else — unreadable dir, e.g. permissions — is §4's
      // log-and-continue failure class, not a silent no-op.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log.warn(
          `[flume] friction harvest: could not read ${mirrorDir}: ${(err as Error).message}`,
        );
      }
      return;
    }
    const candidates = entries.filter((e) => e.isFile());
    if (candidates.length === 0) return;

    // Base-delta bound: a file already present at `baseRef` for this path
    // is delivered history — the checkout brought it in, not this tick's
    // agent — and is left in place rather than re-harvested. Existence
    // only; content is irrelevant to the check.
    const files: Dirent[] = [];
    for (const file of candidates) {
      const relPath = join(stateRootRel, chain.friction, file.name);
      let atBase: string | null;
      try {
        atBase = await git.readFileAtRef(this.opts.repoRoot, baseRef, relPath);
      } catch (err) {
        // Same log-and-continue class as the readdir/mkdir/rename failure
        // modes below: a probe failure isolates to this one candidate
        // rather than aborting the wave's teardown. Left unmoved, matching
        // the fail-closed default a failed rename already leaves in place.
        this.log.warn(
          `[flume] friction harvest: could not probe base for ${relPath}: ${(err as Error).message}`,
        );
        continue;
      }
      if (atBase === null) files.push(file);
    }
    if (files.length === 0) return;

    const primaryDir = join(this.flumeDir, chain.friction);
    try {
      await mkdir(namespacedJoin(primaryDir), { recursive: true });
    } catch (err) {
      this.log.warn(
        `[flume] friction harvest: could not create ${primaryDir}: ${(err as Error).message}`,
      );
      return;
    }

    // Stamped once per harvest call, not per file (§5's writeRevertNote
    // precedent): siblings moved in the same call already disambiguate on
    // file.name, and a shared stamp still separates this call's files from
    // whatever a prior or later retry of the same tag harvests.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const file of files) {
      const src = join(mirrorDir, file.name);
      const dest = join(primaryDir, `${tag}--${stamp}--${file.name}`);
      try {
        await rename(namespacedJoin(src), namespacedJoin(dest));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          // Worktree relocated onto a different volume (FLUME_WORKTREES_DIR)
          // — rename can't cross devices; copy then drop the source instead.
          try {
            await copyFile(namespacedJoin(src), namespacedJoin(dest));
            await rm(namespacedJoin(src), { force: true });
            continue;
          } catch (copyErr) {
            this.log.warn(
              `[flume] friction harvest: failed to move ${src}: ${(copyErr as Error).message}`,
            );
            continue;
          }
        }
        this.log.warn(
          `[flume] friction harvest: failed to move ${src}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Tear down one worktree: the chain's best-effort `teardownWorktree` hook,
   * the friction harvest (§4), removal, then branch deletion — the exact
   * per-worktree sequence `runFanout`'s wave-end cleanup loop ran inline,
   * now shared with a singleton tick's own single worktree (spec/
   * worktrees.md "Singleton runs in a worktree"). `tag` is the entry's tag
   * or the phase name, passed straight through to the hook's `entryTag` and
   * to the harvest's provenance prefix. Returns whether removal succeeded —
   * the caller aggregates surviving paths itself, since a wave reports them
   * once at wave level (§7), not once per worktree.
   */
  private async teardownWorktreeInstance(
    phase: Phase,
    chain: Chain,
    repoRoot: string,
    wt: { path: string; branch: string; baseRef: string },
    tag: string,
  ): Promise<boolean> {
    if (phase.teardownWorktree) {
      try {
        await phase.teardownWorktree({
          worktreePath: wt.path,
          repoRoot,
          entryTag: tag,
        });
      } catch (err) {
        this.log.warn(
          `[flume] teardownWorktree failed for ${wt.path}: ${(err as Error).message}`,
        );
      }
    }
    await this.harvestFriction(chain, wt.path, tag, wt.baseRef);
    let removed = false;
    try {
      await git.removeWorktree(repoRoot, wt.path);
      removed = true;
    } catch {
      // Caller records the surviving path.
    }
    try {
      await git.deleteBranch(repoRoot, wt.branch);
    } catch (err) {
      this.log.warn(
        `[flume] deleteBranch failed for ${wt.branch}: ${(err as Error).message}`,
      );
    }
    return removed;
  }

  /**
   * Startup sweep (`spec/worktrees.md`, "Startup sweep — a dead wave's
   * residue is removed at the next start"): a killed fanout tick abandons
   * its worktrees and their `flume/**` branches — teardown never ran, and
   * per-wave stale-slug removal (`createWorktree`, below) only ever covers
   * an entry being re-provisioned, never one that left the queue entirely.
   * `flume loop` / `flume job run` call this once, after the tip claim is
   * acquired and before the first tick (`src/cli.ts`) — holding the claim
   * is the guard: one flume writer per ref means no live sibling owns
   * anything under this state root's worktree base. A bare `flume tick`
   * never calls this; its per-wave prune and stale-slug removal are
   * unchanged.
   *
   * Scope is exactly the engine's own residue: every directory directly
   * under the worktree base — namespace-scoped the same way
   * `createWorktree`'s path is when a namespace is set. Without one,
   * `sweepBase` is the bare worktrees dir, which a shared
   * `FLUME_WORKTREES_DIR` also holds every *namespaced* sibling job's
   * container directory (`<wtBase>/<their-namespace>/`) at that exact same
   * top level — an arbitrary operator-chosen string, indistinguishable by
   * name alone from one of this job's own bounded `dirName` entries. So a
   * bare `readdir` + blind removal would delete a live sibling's entire
   * worktree tree the first time its container directory sits at this
   * level. The disambiguator is git's own registry, not a naming
   * heuristic (`engine-boundary.md`, "told, not inferred"): `git worktree
   * list --porcelain` names every path git currently considers a
   * worktree, and only entries that are literally one of those paths are
   * this job's own residue to remove through `git.removeWorktree` +
   * win32-fallback (the same path teardown uses) — a sibling's container
   * directory was never itself registered as a worktree, only the paths
   * nested inside it are, so it is left untouched. Then a final `git
   * worktree prune`; then every branch matching this instance's own
   * `flume/[<namespace>/]…` grammar. Branch matching uses `for-each-ref`'s
   * one-level glob (`flume/*` matches `flume/foo`, never `flume/ns/foo`)
   * rather than `branch --list`'s pattern, whose `*` crosses `/` — the
   * non-namespaced case must not sweep a namespaced sibling job's branches
   * sharing the same repo.
   *
   * Never throws: an unreadable or absent base, a surviving worktree
   * directory (locked handle, EBUSY), a prune failure, or a branch that
   * won't delete are each logged and swallowed rather than propagated — a
   * sweep that could abort the run would convert dead residue into a
   * denial of service on the live queue. Silent on an absent or empty
   * base, the normal case; a surviving worktree path is warned once for
   * the whole run, not once per directory.
   */
  async sweepStaleWorktrees(): Promise<void> {
    const repoRoot = this.opts.repoRoot;
    const wtBase = process.env.FLUME_WORKTREES_DIR
      ? resolve(process.env.FLUME_WORKTREES_DIR)
      : join(this.flumeDir, "worktrees");
    const sweepBase = this.opts.namespace
      ? join(wtBase, this.opts.namespace)
      : wtBase;

    let entries: string[];
    try {
      entries = await readdir(namespacedJoin(sweepBase));
    } catch (err) {
      // Absent base is the normal, silent case. Anything else (e.g.
      // permissions) is logged but never aborts the run.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log.warn(
          `[flume] startup sweep: could not read ${sweepBase}: ${(err as Error).message}`,
        );
      }
      return;
    }

    // Which top-level entries are actually this job's own worktrees, as
    // opposed to a sibling namespaced job's container directory sitting at
    // the same level under a shared FLUME_WORKTREES_DIR: git's own registry,
    // not the entry's name. A container directory was never itself `git
    // worktree add`ed, so it never appears here — only the paths nested
    // inside it do.
    const registeredWorktrees = new Set<string>();
    try {
      const { stdout } = await execFileP(
        "git",
        ["worktree", "list", "--porcelain"],
        { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
      );
      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          registeredWorktrees.add(resolve(line.slice("worktree ".length).trim()));
        }
      }
    } catch (err) {
      this.log.warn(
        `[flume] startup sweep: could not list registered worktrees: ${(err as Error).message}`,
      );
    }

    const survivingPaths: string[] = [];
    for (const name of entries) {
      const path = join(sweepBase, name);
      if (!registeredWorktrees.has(resolve(path))) {
        // Not a worktree git knows about — most commonly a sibling
        // namespaced job's container directory. Not this job's residue;
        // leave it untouched.
        continue;
      }
      try {
        await git.removeWorktree(repoRoot, path);
      } catch {
        survivingPaths.push(path);
      }
    }
    try {
      await git.pruneWorktrees(repoRoot);
    } catch (err) {
      this.log.warn(
        `[flume] startup sweep: worktree prune failed: ${(err as Error).message}`,
      );
    }

    const branchPattern = this.opts.namespace
      ? `flume/${this.opts.namespace}/*`
      : "flume/*";
    let branches: string[] = [];
    try {
      const { stdout } = await execFileP(
        "git",
        [
          "for-each-ref",
          "--format=%(refname:short)",
          `refs/heads/${branchPattern}`,
        ],
        { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
      );
      branches = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch (err) {
      this.log.warn(
        `[flume] startup sweep: could not list ${branchPattern} branches: ${(err as Error).message}`,
      );
    }
    for (const branch of branches) {
      try {
        await git.deleteBranch(repoRoot, branch);
      } catch (err) {
        this.log.warn(
          `[flume] startup sweep: deleteBranch failed for ${branch}: ${(err as Error).message}`,
        );
      }
    }

    if (survivingPaths.length > 0) {
      this.log.warn(
        `[flume] startup sweep: ${survivingPaths.length} worktree(s) survived removal (fallback exhausted): ${survivingPaths.join(", ")}`,
      );
    }
  }

  /**
   * Provision one worktree, branched `flume/[<namespace>/]<tag>` from
   * `fromRef`. Shared by fanout (`tag` = the entry's own tag) and singleton
   * (`tag` = the phase name — a singleton tick has no entry; spec/worktrees.md
   * "Singleton runs in a worktree" keys its worktree on the phase instead).
   * Both directory-name length-bounding (§9) and job-namespace scoping apply
   * identically either way — the caller supplies the identifier, this method
   * doesn't care what it names.
   */
  private async createWorktree(
    tag: string,
    fromRef: string,
  ): Promise<{ path: string; branch: string; baseRef: string }> {
    const slug = slugify(tag);
    // Job-scoped branch namespace (v0.5 §4): with a namespace, identical
    // slugs across jobs land on disjoint branches; without one, the legacy
    // repo-global name stands (bare `.flume` harnesses unchanged).
    const branch = this.opts.namespace
      ? `flume/${this.opts.namespace}/${slug}`
      : `flume/${slug}`;
    // FLUME_WORKTREES_DIR: ephemeral worktrees relocate OUTSIDE the repo so an
    // agent's pwd never contains the root checkout's path as a prefix (the
    // observed stray-write vector: a model that sees `<root>/.flume/worktrees/x`
    // derives `<root>` and operates there). Default tracks the state root
    // (§16), which is itself relocatable via FLUME_DIR.
    const wtBase = process.env.FLUME_WORKTREES_DIR
      ? resolve(process.env.FLUME_WORKTREES_DIR)
      : join(this.flumeDir, "worktrees");
    // The path mirrors the branch namespacing: under a shared
    // FLUME_WORKTREES_DIR two jobs with identical slugs would otherwise
    // collide on <base>/<dirName>, and the stale-cleanup below would rm the
    // OTHER job's live worktree. Namespaced unconditionally when set — the
    // redundant level under a default per-job base is harmless.
    //
    // The fs directory name is length-bounded (§9) — git itself refuses a
    // worktree path around 200 chars on win32, below `TAG_MAX_LENGTH`'s
    // NAME_MAX-derived ceiling — while `branch` above keeps the untruncated
    // slug: `tag` stays full-length everywhere except this one directory
    // component. A phase name takes the same bound an entry tag does.
    const dirName = worktreeDirName(tag);
    const path = this.opts.namespace
      ? join(wtBase, this.opts.namespace, dirName)
      : join(wtBase, dirName);
    if (existsSync(toNamespacedPath(path))) {
      // Stale from a prior crashed run; clean up.
      try {
        await git.removeWorktree(this.opts.repoRoot, path);
      } catch {
        await rm(toNamespacedPath(path), { recursive: true, force: true });
      }
    }
    await mkdir(toNamespacedPath(dirname(path)), { recursive: true });
    // Fanout worktrees nest at least as deep as the job dir they're cloned
    // for (v0.4 §6) — the identical win32 MAX_PATH gap job.ts's own baseline
    // pin exists to spare.
    await git.pinLongPaths(this.opts.repoRoot);
    await git.addWorktree({
      repoRoot: this.opts.repoRoot,
      path,
      branch,
      fromRef,
    });
    return { path, branch, baseRef: fromRef };
  }

  // ---------- prior-attempt persistence (§5) ----------

  /**
   * Key under which a phase/entry's prior-attempt record lives: the entry
   * tag slug for fanout, the phase name for singleton. A retry is scheduled
   * "for that same entry (fanout) or phase (singleton)" — the key mirrors
   * exactly that scope so the next tick reads its own predecessor.
   */
  private priorAttemptKey(phase: Phase, entry?: PendingEntry): string {
    return entry ? slugify(entry.tag) : phase.name;
  }

  private priorAttemptPath(key: string): string {
    return join(this.flumeDir, PRIOR_ATTEMPTS_SUBDIR, `${key}.json`);
  }

  /**
   * Read a persisted prior-attempt record, if any. Corrupt, or carrying an
   * unrecognized `mode` discriminant → treated as absent: the renderer is
   * exhaustive over the five known modes and must never be fed an unknown
   * shape (and a stale slot should never become a false signal).
   */
  private async readPriorAttempt(
    key: string,
  ): Promise<PriorAttempt | undefined> {
    const p = this.priorAttemptPath(key);
    if (!existsSync(toNamespacedPath(p))) return undefined;
    try {
      const rec = JSON.parse(
        await readFile(toNamespacedPath(p), "utf8"),
      ) as { mode?: unknown };
      if (
        rec &&
        (rec.mode === "gate-revert" ||
          rec.mode === "voluntary-bail" ||
          rec.mode === "platform-preempt" ||
          rec.mode === "render-refused" ||
          rec.mode === "tip-moved")
      ) {
        return rec as PriorAttempt;
      }
      return undefined;
    } catch {
      // A garbled record must not crash the tick — degrade to "no prior".
      return undefined;
    }
  }

  private async writePriorAttempt(
    key: string,
    rec: PriorAttempt,
  ): Promise<void> {
    const p = this.priorAttemptPath(key);
    await mkdir(toNamespacedPath(dirname(p)), { recursive: true });
    await writeFile(
      toNamespacedPath(p),
      JSON.stringify(rec, null, 2) + "\n",
      "utf8",
    );
  }

  /**
   * Clear a prior-attempt record once a later attempt commits clean — both
   * the §5 JSON and the §8 reverted-prose snapshot, so a clean ship leaves no
   * stale recovery artifact (the same no-false-signal invariant the §5 slot
   * already holds, extended to the prose snapshot).
   */
  private async clearPriorAttempt(key: string): Promise<void> {
    await rm(toNamespacedPath(this.priorAttemptPath(key)), { force: true });
    await rm(toNamespacedPath(this.revertedSnapshotDir(key)), {
      recursive: true,
      force: true,
    });
  }

  // ---------- reverted-prose durability (§8) ----------

  /**
   * Durable, gitignored snapshot dir for a gate-reverted commit's files.
   * Sibling to the §5 JSON under `<flumeDir>/prior-attempts/` (NOT the
   * per-entry worktree) so it outlives both `git reset --hard` and a fanout
   * worktree teardown — the same durability the §5 record relies on.
   */
  private revertedSnapshotDir(key: string): string {
    return join(this.flumeDir, PRIOR_ATTEMPTS_SUBDIR, `${key}.reverted`);
  }

  /**
   * Snapshot every non-deleted file the reverted commit touched, verbatim,
   * into the durable snapshot dir before the hard reset destroys it (§8).
   *
   * A gate-reverted plan tick otherwise loses its state.md /
   * open-questions.md prose to `git reset --hard`, recoverable only by a
   * human reading `.flume/sessions/` logs. The snapshot is post-image content
   * under a mirror of the repo path, so recovery is "open the file" — not
   * "read a diff", not "grep a session log". `diffStat` (the §5 digest) is
   * `git show --stat`: filenames and counts, never content — it cannot
   * recover findings, which is why §8 needs this distinct artifact.
   *
   * Generic by construction: it snapshots whatever the reverted commit
   * changed (for plan that is the prose plus the schema-failing
   * pending.json), so the dispatcher needs no chain-specific notion of which
   * artifact is "prose" vs "machine-checkable". Must run while `sha` is still
   * reachable (before the drop). Best-effort: §8 mandates the property, not a
   * guarantee under a broken git — a snapshot failure must never block or
   * fail the revert.
   */
  private async snapshotRevertedFiles(
    cwd: string,
    sha: string,
    key: string,
  ): Promise<void> {
    const dir = this.revertedSnapshotDir(key);
    try {
      // The artifact tracks the *latest* reverted attempt only — drop any
      // stale snapshot from an earlier revert under this key first.
      await rm(toNamespacedPath(dir), { recursive: true, force: true });
      const { stdout } = await execFileP(
        "git",
        [
          "show",
          "--name-only",
          "--diff-filter=d",
          "--format=",
          "--no-color",
          sha,
        ],
        { cwd, maxBuffer: 16 * 1024 * 1024 },
      );
      const files = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const rel of files) {
        const { stdout: content } = await execFileP(
          "git",
          ["show", `${sha}:${rel}`],
          { cwd, maxBuffer: 16 * 1024 * 1024 },
        );
        const dest = join(dir, rel);
        // win32 MAX_PATH (`.claude/rules/platform-facts.md`): dest depth
        // here is driven by the reverted diff's own path depth, not
        // chain.friction, but it's the same join(dir, rel) unwrapped shape
        // writeRevertNote/harvestFriction guard use — same idiom.
        await mkdir(toNamespacedPath(dirname(dest)), { recursive: true });
        await writeFile(toNamespacedPath(dest), content, "utf8");
      }
    } catch {
      // Recovery is best-effort by spec; never block or fail the revert path.
    }
  }

  /**
   * Bounded `git show --stat` of the reverted commit — the §5 digest so the
   * retry does not blindly reconstruct. Must be called while `sha` is still
   * reachable (before the hard reset / commit drop). Best-effort: a failure
   * here must not block the revert path.
   */
  private async capturedDiffStat(cwd: string, sha: string): Promise<string> {
    try {
      const { stdout } = await execFileP(
        "git",
        ["show", "--stat", "--oneline", "--no-color", sha],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      return bound(stdout.trimEnd(), MAX_PRIOR_DIFFSTAT);
    } catch {
      return "(diff stat unavailable)";
    }
  }

  /**
   * Subject + body of a commit, read while `sha` is still reachable (before
   * the hard reset / commit drop). Best-effort: a failure here must not
   * block the revert path.
   */
  private async capturedCommitMessage(
    cwd: string,
    sha: string,
  ): Promise<{ subject: string; body: string }> {
    try {
      const { stdout: subject } = await execFileP(
        "git",
        ["show", "-s", "--format=%s", "--no-color", sha],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      const { stdout: body } = await execFileP(
        "git",
        ["show", "-s", "--format=%b", "--no-color", sha],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      return { subject: subject.trim(), body: body.trim() };
    } catch {
      return { subject: "(commit message unavailable)", body: "" };
    }
  }

  /**
   * §5 (RELEASE-v0.6.2): when an afterCommit gate reverts a worktree's
   * commit and `Chain.friction` is declared, write the operator's copy of
   * the verdict — the gate name/message/details plus the reverted commit's
   * subject+body — to `<friction>/<ISO-timestamp>--<tag>--reverted.md`
   * before `git.dropLastCommit` discards the evidence. Written straight to
   * the primary friction dir (harness code reaching into `flumeDir`, the
   * sessions/harvest precedent) rather than the worktree-local mirror —
   * this runs mid-wave (or mid-singleton-tick), well before that worktree's
   * own teardown harvest.
   *
   * `tag` is the fanout entry's tag or, for a singleton phase's own
   * afterCommit revert, the phase name (spec/worktrees.md "Singleton runs in
   * a worktree" collapsed the former asymmetry — the note used to be
   * fanout-only, since a singleton commit lived in the operator's own
   * checkout until it was gated; now it lives in a worktree the tick tears
   * down, so the note is what remains).
   *
   * Undeclared `chain.friction` is a no-op, per §2. Best-effort: a
   * note-write failure must never block the revert it is documenting.
   */
  private async writeRevertNote(
    chain: Chain,
    cwd: string,
    sha: string,
    tag: string,
    failure: { gate: string; message: string; details?: string },
  ): Promise<void> {
    if (chain.friction === undefined) return;
    try {
      const { subject, body } = await this.capturedCommitMessage(cwd, sha);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const primaryDir = join(this.flumeDir, chain.friction);
      // win32 MAX_PATH (`.claude/rules/platform-facts.md`): TAG_MAX_LENGTH
      // bounds only the filename component, not the friction dir's full
      // depth. namespacedJoin (src/paths.ts) is the shared idiom.
      await mkdir(namespacedJoin(primaryDir), { recursive: true });
      const lines = [
        `# Gate revert: ${failure.gate}`,
        "",
        failure.message,
        ...(failure.details ? ["", "## Details", "", failure.details] : []),
        "",
        "## Reverted commit",
        "",
        subject,
        ...(body ? ["", body] : []),
        "",
      ];
      await writeFile(
        namespacedJoin(primaryDir, `${stamp}--${tag}--reverted.md`),
        lines.join("\n"),
        "utf8",
      );
    } catch (err) {
      this.log.warn(
        `[flume] ${tag}: revert note write failed: ${(err as Error).message}`,
      );
    }
  }

  private async buildPriorAttempt(
    when: GateRevertAttempt["when"],
    failure: { gate: string; message: string; details?: string },
    diffCwd: string,
    sha: string,
  ): Promise<GateRevertAttempt> {
    const diffStat = await this.capturedDiffStat(diffCwd, sha);
    return {
      mode: "gate-revert",
      when,
      gate: failure.gate,
      message: failure.message,
      ...(failure.details
        ? { details: tailBound(failure.details, MAX_PRIOR_DETAILS) }
        : {}),
      diffStat,
    };
  }

  /**
   * Classify a no-commit-no-gate tick (§6) and persist the matching §5
   * record so the retry's prompt carries it. A clean agent exit that
   * produced nothing is a **voluntary-bail** — the constraint it refused is
   * its final message (the build/plan prompts instruct the agent to name the
   * writablePaths/Rule-0/spec gap there); a **platform-preempt** otherwise —
   * the non-work failure class, explicitly not a defect in the work. Returns
   * the mode for `TickOutcome` / the logger record.
   */
  private async classifyNoCommit(
    key: string,
    termination: AgentTermination,
  ): Promise<NoCommitMode> {
    if (termination.kind === "clean") {
      await this.writePriorAttempt(key, buildVoluntaryBail(termination.stdout));
      return "voluntary-bail";
    }
    await this.writePriorAttempt(
      key,
      buildPlatformPreempt(termination.failureClass),
    );
    return "platform-preempt";
  }

  /**
   * Persist the RELEASE-v0.10 §3 render-refused record and log it — the one
   * shared shape both the singleton and fanout render callsites route
   * through (engineering.md "The fix lands at the mechanism"), the same way
   * {@link classifyNoCommit} above already centralizes the §6 persist+log.
   * Each callsite still builds its own return shape from here, matching how
   * `classifyNoCommit`'s two callers already differ. `label` is the
   * phase name (singleton) or entry tag (fanout) — whichever scope `key`
   * itself was derived from.
   */
  private async persistRenderRefused(
    key: string,
    label: string,
    err: InlineExecRenderError,
  ): Promise<void> {
    await this.writePriorAttempt(key, buildRenderRefused(err));
    this.log.warn(
      `[flume] ${label}: render-refused (no commit): ${err.message}`,
    );
  }

  /**
   * Strict reader: throws {@link PendingParseFailure} on a parse error rather
   * than degrading to `[]`. Used at every read this dispatcher acts on — the
   * singleton/fanout decide-reads and `commitPendingUpdate`'s rewrite read
   * (engineering.md "Loud or nothing": a decision or a rewrite must never
   * derive from an input that failed to resolve). `readPendingTolerant`
   * below is the one declared exception, for the two report-only reads.
   *
   * spec/pending.md "Dispatch reads come from the tip, not the tree":
   * resolves the committed `HEAD` tip (`git.readFileAtRef`), never the
   * working tree — a mid-wave merge, an engine revert, or an operator's
   * staged edit can each leave the tree ahead of or behind the branch, and a
   * dispatch decision must never act on state no commit owns. An out-of-tree
   * `pendingPath` (a relocated state root) has no tip to read — invisible to
   * git by construction (`commitPendingUpdate` below), so it stays the one
   * disk-reading case here, alongside `readPendingTolerant`.
   */
  private async readPending(): Promise<PendingEntry[]> {
    if (this.isPendingRelocated()) {
      // win32 MAX_PATH: a relocated pendingPath sits under an arbitrary
      // state root. namespacedJoin (src/paths.ts) is the shared idiom.
      if (!existsSync(namespacedJoin(this.pendingPath))) return [];
      const raw = await readFile(namespacedJoin(this.pendingPath), "utf8");
      const r = parsePending(raw, this.entryExtension);
      if (!r.ok) throw new PendingParseFailure(r.errors);
      return r.entries;
    }
    const rel = relative(this.opts.repoRoot, this.pendingPath);
    const raw = await git.readFileAtRef(this.opts.repoRoot, "HEAD", rel);
    if (raw === null) return [];
    const r = parsePending(raw, this.entryExtension);
    if (!r.ok) throw new PendingParseFailure(r.errors);
    return r.entries;
  }

  /**
   * Whether `pendingPath` sits outside `repoRoot` — an out-of-tree state
   * root's ledger, invisible to git by construction. Shared by
   * `readPending`'s tip-vs-disk choice and `commitPendingUpdate`'s
   * commit-vs-disk-only choice: one relocation check, not two independently
   * re-derived ones.
   */
  private isPendingRelocated(): boolean {
    const rel = relative(this.opts.repoRoot, this.pendingPath);
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  }

  /**
   * Tolerant twin of `readPending()`, kept only for `TickResult.pendingAfter`
   * — an informational re-read taken after this tick's own strict decide- or
   * rewrite-read already ran (and, for the fanout wave, after any shipped
   * work already landed on trunk). A parse failure here means something
   * outside this tick corrupted the file in the gap between that strict read
   * and now; degrading to `[]` is bounded because `pendingAfter` feeds only
   * `chain.ts`'s advisory `hasPickable` handoff check, never a rewrite or a
   * work decision (engineering.md "Loud or nothing": the degraded-but-
   * proceeding path, declared and cited at its two call sites).
   */
  private async readPendingTolerant(): Promise<PendingEntry[]> {
    // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
    if (!existsSync(namespacedJoin(this.pendingPath))) return [];
    const raw = await readFile(namespacedJoin(this.pendingPath), "utf8");
    const r = parsePending(raw, this.entryExtension);
    if (!r.ok) {
      this.log.warn(
        `[flume] pending.json failed to parse (${r.errors.length} errors); treating as empty`,
      );
      return [];
    }
    return r.entries;
  }

  /**
   * spec/loop.md "Tip verify", "Harness-driven commits carry no expected-tip
   * bookkeeping": no sha comparison — `liveForeignClaimPid`, checked fresh
   * immediately before this method's own harness-driven `commitPaths` call,
   * the wave's other tip-verify site beside `cherryPick` (`runFanout`,
   * above). Checked before `writeFile`: a refusal here leaves pending.json
   * untouched on disk rather than a write with no commit behind it. No live
   * claim means the rewrite recommits on whatever tip is current — its
   * content derives from the wave's own outcomes, never from a recorded tip.
   */
  private async commitPendingUpdate(
    shippedTags: string[],
    mergeOutcomes: readonly TickVerdictMergeOutcome[],
  ): Promise<{ sha: string; tipMoved: boolean }> {
    // v0.8 §5: footprint content sources from the wave's own TickVerdict
    // record (mergeOutcomes) rather than a separately maintained map — a
    // view over the same facts `tick()` persists, not a second capture.
    const observed = new Map(
      mergeOutcomes
        .filter((m) => m.footprint && m.footprint.length > 0)
        .map((m) => [m.tag, m.footprint!] as const),
    );
    const shipped = new Set(shippedTags);
    // Re-read pending.json fresh, right before deriving the rewrite —
    // NOT the tick-start snapshot the caller read before provisioning
    // worktrees and running agents. A fanout wave's fanned-out agent runs
    // and serial cherry-picks can take long enough for another process
    // (a concurrent tick, a hand fix) to land its own commit to
    // pending.json on trunk in the meantime; deriving from the stale
    // snapshot would blindly overwrite that concurrent write with
    // whatever this wave saw at tick start — silently resurrecting
    // retired fields or reverting fixes in entries this wave never
    // touched. Sourcing the rewrite from the current on-disk state at
    // write time means this wave only ever removes the tags it shipped
    // and touches observedFiles/blockedBy for tags it knows about.
    const current = await this.readPending();
    // A blockedBy gate naming a tag this wave shipped is resolved HERE,
    // mechanically: the dispatcher just merged and gated that tag, so
    // "did the blocker land" needs no plan tick — the next wave forms
    // without a plan interim. Judgment gates (parked) stay plan's.
    const after = current
      .filter((e) => !shipped.has(e.tag))
      .map((e) =>
        e.gate.kind === "blockedBy" && shipped.has(e.gate.tag)
          ? { ...e, gate: { kind: "open" as const } }
          : e,
      )
      .map((e) => {
        const obs = observed.get(e.tag);
        if (!obs || obs.length === 0) return e;
        const merged = [...new Set([...(e.observedFiles ?? []), ...obs])];
        return { ...e, observedFiles: merged };
      });
    const serialized = JSON.stringify(after, null, 2) + "\n";
    // A footprint-only update can be a no-op (same collision, same paths,
    // second time around) — committing an unchanged file fails, so skip.
    // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
    const existing = await readFile(
      namespacedJoin(this.pendingPath),
      "utf8",
    ).catch(() => "");
    if (serialized === existing) {
      return { sha: await git.revParse(this.opts.repoRoot), tipMoved: false };
    }
    // A relocated flumeDir puts pendingPath outside the repo, where staging
    // it would fatal — after the entries already merged. An out-of-tree dock
    // is invisible to git by construction, so no chore commit is wanted: the
    // disk write alone carries the auto-unblock and observedFiles forward —
    // computed before the tip check below, which only guards the git-commit
    // path this dock never takes.
    const relocated = this.isPendingRelocated();

    if (!relocated) {
      // spec/loop.md "Tip verify", re-checked fresh immediately before this
      // method's own commit — the wave's other harness-driven commit besides
      // `cherryPick`. Checked before `writeFile`: a refusal here leaves
      // pending.json untouched on disk, never a write with no commit behind
      // it. Shipped entries this wave already cherry-picked stay shipped
      // regardless — only the ledger update itself is refused.
      const foreignClaim = await this.liveForeignClaimPid(this.opts.repoRoot);
      if (foreignClaim !== null) {
        return {
          sha: await git.revParse(this.opts.repoRoot),
          tipMoved: true,
        };
      }
    }

    // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
    await mkdir(namespacedJoin(dirname(this.pendingPath)), {
      recursive: true,
    });
    await writeFile(namespacedJoin(this.pendingPath), serialized, "utf8");
    if (relocated) {
      return { sha: await git.revParse(this.opts.repoRoot), tipMoved: false };
    }
    // Scoped to pending.json — `git add -A` would sweep up untracked worktree
    // metadata and unrelated user changes into the harness's chore commit.
    const footprintTags = [...observed.keys()];
    const message =
      this.opts.commitMessage?.(shippedTags, footprintTags) ??
      (shippedTags.length > 0
        ? `chore(flume): ship ${shippedTags.join(", ")}`
        : `chore(flume): record merge-failure footprints for ${footprintTags.join(", ")}`);
    const sha = await git.commitPaths({
      cwd: this.opts.repoRoot,
      message,
      paths: [this.pendingPath],
    });
    return { sha, tipMoved: false };
  }
}

// ---------- loop supervisor (§2) ----------

/** Options for {@link superviseLoop}. */
export interface SuperviseLoopOptions {
  /** Repo root; child ticks spawn with this as their cwd. */
  repoRoot: string;
  /**
   * Mutable-state root the supervisor reads baton state from between child
   * ticks. Must match the `flumeDir` the children write to (the CLI carries it
   * across the process boundary via the `FLUME_DIR` env var, which children
   * inherit). Defaults to `<repoRoot>/.flume`.
   */
  flumeDir?: string;
  /**
   * Chain+prompts dir the supervisor loads the chain from for the loop-end
   * friction summary (§6, v0.6.2) — repo-resident, never a job dir (mirrors
   * every other `configDir` default). Defaults to `<repoRoot>/.flume`.
   */
  configDir?: string;
  /** Max child ticks before stopping (the `--max N` cap). Default 50. */
  maxTicks?: number;
  log?: Logger;
  /**
   * §8 (v0.8, RELEASE-v0.8): chain-declared override for §16's run-scoped
   * quarantine (RELEASE-v0.7; generalized past provisioning to the merge and
   * gate stages, spec/loop.md "Repeated identical failures"). `"none"`
   * disables per-entry quarantine outright — a tagged provision/merge/gate
   * failure is never withheld from later ticks this run — while the
   * consecutive-identical-failure backstop (`abortThreshold` below) still
   * applies. Default `"run"`: quarantine a tagged failure's slug for the
   * rest of the run — exact default byte shape pinned by
   * tests/Dispatcher.test.ts's "a chain declaring neither knob gets the v0.7
   * §16 defaults, byte-identical" case. The CLI forwards this from the
   * resolved chain's `supervisorPolicy.quarantineScope` (`src/Phase.ts`);
   * undeclared falls through to the default here.
   */
  quarantineScope?: "run" | "none";
  /**
   * §8: chain-declared override for §16's consecutive-identical-failure
   * abort threshold (RELEASE-v0.7; generalized past provisioning) — the
   * number of consecutive ticks the same *stage-tagged* signature
   * (provision, merge, or gate) must repeat, with no successful tick between
   * them, before the run aborts. Default 3, pinned by the same
   * tests/Dispatcher.test.ts case cited on `quarantineScope` above. The CLI
   * forwards this from the resolved chain's `supervisorPolicy.abortThreshold`;
   * undeclared falls through to the default here.
   */
  abortThreshold?: number;
  /**
   * Run one `flume tick` as a fresh child process; resolves with its exit
   * code when it exits. Defaults to re-execing the running flume entrypoint
   * (mirrors `process.execArgv`/`argv[1]`, so it works whether launched from
   * the built `dist/cli.js` or `tsx src/cli.ts`). Injected by tests — the
   * stubbed-spawn seam. `quarantinedSlugs` (§16, RELEASE-v0.7) is this run's
   * accumulated run-scoped quarantine so far — the default runner carries it
   * to the child via the `FLUME_QUARANTINED_SLUGS` env var; a test stub may
   * ignore it.
   */
  runTick?: (
    quarantinedSlugs: ReadonlySet<string>,
  ) => Promise<{ exitCode: number | null }>;
}

/** Outcome of a supervised loop: how many child ticks ran and why it stopped. */
export interface SuperviseResult {
  ticks: number;
  hibernated: boolean;
  /**
   * Set when the loop fail-fasted on a child exiting
   * {@link EX_TERMINAL_MISCONFIG} (§3). `phases` are the orphaned awake
   * flags read off disk for the summary — the stop *decision* is the exit
   * code alone.
   */
  terminal?: TerminalMisconfiguration;
  /**
   * Set when the loop fail-fasted on a child exiting {@link EX_MOUNT_DEAD}
   * (v0.7 §4): the mount-dead failure class (chain cannot load, state root
   * missing, declaration invalid). Distinct from `terminal` — a
   * mount-dead run never resolved a chain at all, so there is no phase list
   * to name in the summary, only the fact of the abort.
   */
  mountDead?: boolean;
  /**
   * Every entry tag shipped by any child tick this run (v0.7 §4 amendment),
   * accumulated across iterations from each child's on-disk {@link
   * TickVerdict} — the run-level exit-code decision (§4: non-zero iff ≥1
   * tick errored AND zero entries shipped) needs the whole run's total, not
   * just the last tick's.
   */
  shippedTags: string[];
  /**
   * One line per child tick that errored — a genuine tick-level failure
   * (`gate-revert` or `platform-preempt`, derived from the tick's {@link
   * TickVerdict} at the read site; v0.8 §5) — this run, in tick order, read
   * alongside `shippedTags`. Non-empty even on a 0 exit (partial success:
   * ships landed despite some tick errors) — `flume loop`'s completion
   * summary names these so they never vanish into a silent green exit (§4).
   */
  erroredTicks: string[];
  /**
   * §16 (RELEASE-v0.7; generalized past provisioning to the merge and gate
   * stages, spec/loop.md "Repeated identical failures"): set when the run
   * aborted because the same stage-tagged signature repeated on
   * `abortThreshold` (default 3, v0.8 §8) consecutive ticks with no
   * successful tick between them — the consecutive-failure backstop for
   * non-entry-scoped walls the run-scoped quarantine can't isolate
   * (generalizes §4's mount-dead abort past its class without touching §4's
   * own semantics). `signature` is the raw comparison key, never prefixed
   * with the stage it came from — the stage only disambiguates the internal
   * streak, never the reported shape. Distinct from `mountDead` — the chain
   * resolved and ran fine; only a provision, merge, or gate wall kept
   * hitting the identical failure.
   */
  repeatedFailure?: { signature: string; count: number };
  /**
   * spec/loop.md "Graceful stop — the stop flag": set when `<flumeDir>/stop`
   * was found present at the per-iteration boundary after a child tick
   * finished, ending the run there rather than at hibernation or `--max`.
   * Distinct from `hibernated` — the baton may still carry awake flags when
   * a stop ends the run; `hibernated` above reflects the baton's actual
   * disk state at that same moment, independent of this field. Read by
   * `flume loop`'s completion summary to name the stop flag as the reason
   * iteration ended (spec/loop.md); never consulted by `loopExitCode` —
   * a stopped run's exit code stays decided by the run totals alone.
   */
  stoppedByFlag?: boolean;
}

/**
 * `flume loop` supervisor (§2). Spawns exactly one `flume tick` child process
 * per iteration, carrying no in-memory chain or phase state across them — the
 * only correct re-resolution mechanism (Node's ESM registry is non-evictable,
 * so an in-process loop is pinned to chain.ts's first evaluation; see
 * `loadChainModule`). Between children it reads the on-disk baton
 * (disk-is-truth): no awake flags ⇒ hibernation ⇒ stop. A child that exits
 * a plain tick failure (agent-level, per-entry) is logged and the loop
 * proceeds — the supervisor never crashes — except
 * {@link EX_TERMINAL_MISCONFIG} (Axis-C terminal misconfiguration) and
 * {@link EX_MOUNT_DEAD} (v0.7 §4 mount-dead: the chain never resolved),
 * either of which stops the loop immediately: both defeat the hibernation
 * check (nothing on disk changed to reflect them), so proceeding would
 * hot-spin to `--max` while masquerading each iteration as routine. Bounded
 * by `maxTicks` (the `--max N` cap).
 */
export async function superviseLoop(
  opts: SuperviseLoopOptions,
): Promise<SuperviseResult> {
  const log = opts.log ?? consoleLogger;
  const maxTicks = opts.maxTicks ?? 50;
  const flumeDir = opts.flumeDir ?? join(opts.repoRoot, ".flume");
  const configDir = opts.configDir ?? join(opts.repoRoot, ".flume");
  const baton = new Baton(flumeDir);
  const runTick = opts.runTick ?? defaultTickRunner(opts.repoRoot);

  // §6 (v0.6.2): best-effort — a missing or broken chain must never fail
  // the loop-end summary, only silently withhold the friction line.
  const logFrictionSummary = async (): Promise<void> => {
    try {
      const { chain } = await diskChainLoader(configDir)();
      const line = await frictionCountLine(flumeDir, chain);
      if (line) log.info(`[flume] ${line}`);
    } catch {
      // no chain, or a chain that fails to load — nothing to summarize
    }
  };

  // §8: engine defaults, overridable per opts above.
  const quarantineScope = opts.quarantineScope ?? "run";
  const abortThreshold = opts.abortThreshold ?? 3;

  let ticks = 0;
  const shippedTags = new Set<string>();
  const erroredTicks: string[] = [];
  // §16: run-scoped quarantine (entry-tag slugs whose worktree provisioning
  // failed on some earlier tick this run) plus the consecutive-identical-
  // signature streak for the abort backstop. Both reset to empty on every
  // fresh `superviseLoop` call — quarantine never outlives the run.
  const quarantinedSlugs = new Set<string>();
  // spec/loop.md "Repeated identical failures — quarantine, then abort"
  // generalizes both legs past provisioning to the merge and gate stages,
  // keyed by *stage-tagged* signature (`${stage}:${signature}`) so a
  // coincidentally-identical message from a different stage never shares a
  // streak with this one, and never shadows it in the quarantine loop either.
  // Keyed by signature, not "the last one seen" — a tick's failures can carry
  // several distinct signatures across stages (a repo-level provisioning
  // failure pushed first, then per-entry ones, then a merge or gate failure),
  // and any of them can be the one that repeats every tick. Tracking only
  // index 0 let a varying sibling there shadow a genuinely-repeating
  // signature elsewhere in the list forever.
  const failureStreaks = new Map<string, number>();
  for (let i = 0; i < maxTicks; i++) {
    const { exitCode } = await runTick(quarantinedSlugs);
    ticks++;

    // v0.8 §5: recover this tick's facts from its verdict artifact — the
    // exit code alone (settled/errored/mount-dead) is the only signal that
    // crosses the child→supervisor boundary today (child stdio stays
    // `inherit`), and it can't carry a run-wide total. Absent on a tick that
    // returned before reaching the write (chain-load failure, hibernation,
    // terminal misconfiguration) — nothing to add. `errored` is not a stored
    // field on the verdict (v0.8 §5: facts only) — derived here, at the read
    // site, from the same formula v0.7 §4 used: a genuine tick-level failure
    // is `gate-revert`/`platform-preempt`/`render-refused` (RELEASE-v0.10
    // §3: the prompt itself was broken), `tipMoved` (RELEASE-v0.11 §5: the
    // ref moved out from under this tick — worth surfacing even on a wave
    // that also shipped something, unlike the provisioning/merge legs below,
    // since it signals something else is writing to this ref), or a
    // provisioning or merge (cherry-pick) failure that left nothing shipped
    // — never a `voluntary-bail` (the agent correctly declining and naming
    // the constraint is not evidence anything went wrong).
    const verdict = await readTickVerdict(flumeDir);
    let countedAsErrored = false;
    if (verdict) {
      for (const tag of verdict.shippedTags) shippedTags.add(tag);
      const verdictProvisionFailures = verdict.provisionFailures ?? [];
      const verdictMergeFailures = verdict.mergeFailures ?? [];
      const errored =
        verdict.noCommit === "gate-revert" ||
        verdict.noCommit === "platform-preempt" ||
        verdict.noCommit === "render-refused" ||
        verdict.tipMoved === true ||
        (verdictProvisionFailures.length > 0 &&
          verdict.shippedTags.length === 0) ||
        (verdictMergeFailures.length > 0 && verdict.shippedTags.length === 0);
      if (errored) {
        erroredTicks.push(
          verdictProvisionFailures.length > 0
            ? `${verdict.summary} — worktree provisioning failed: ${verdictProvisionFailures
                .map((f) => (f.tag ? `${f.tag} (${f.signature})` : f.signature))
                .join("; ")}`
            : verdictMergeFailures.length > 0
              ? `${verdict.summary} — merge failed: ${verdictMergeFailures
                  .map((f) =>
                    f.tag ? `${f.tag} (${f.signature})` : f.signature,
                  )
                  .join("; ")}`
              : verdict.summary,
        );
        countedAsErrored = true;
      }
    }

    // §16 (generalized past provisioning): every per-entry failure fact the
    // verdict records, tagged with the stage it came from — a voluntary bail
    // or park never joins this list, since neither writes a provision/merge/
    // gate failure record at all.
    const failures: Array<{
      stage: "provision" | "merge" | "gate";
      tag?: string;
      signature: string;
      message: string;
    }> = [
      ...(verdict?.provisionFailures ?? []).map((f) => ({
        stage: "provision" as const,
        ...f,
      })),
      ...(verdict?.mergeFailures ?? []).map((f) => ({
        stage: "merge" as const,
        ...f,
      })),
      ...(verdict?.gateFailures ?? []).map((f) => ({
        stage: "gate" as const,
        ...f,
      })),
    ];

    // Quarantine every *tagged* failure this tick named, whichever stage it
    // came from — isolating the slug so the rest of the run stops
    // re-attempting a wall it already hit once. A repo-level/untagged failure
    // (no single entry to blame) falls to the backstop below instead. §8: a
    // chain declaring `quarantineScope: "none"` opts out of this leg
    // entirely — the backstop below still fires.
    if (quarantineScope !== "none") {
      for (const f of failures) {
        if (!f.tag) continue;
        const slug = slugify(f.tag);
        if (!quarantinedSlugs.has(slug)) {
          quarantinedSlugs.add(slug);
          log.warn(
            `[flume] quarantining ${f.tag} for the rest of this run: ${f.stage}-stage ` +
              `failure (${f.signature})`,
          );
        }
      }
    }

    // Fold every stage-tagged signature into the consecutive-identical
    // streak (the backstop for the non-entry-scoped class quarantine can't
    // isolate, e.g. a repo-level `git worktree prune` failure, or a
    // singleton's own gate revert — nothing to quarantine either way). A
    // tick with no failure of a given stage-tagged signature clears that
    // signature's streak — only an unbroken run of the identical wall
    // counts.
    const thisSignatures = new Map(
      failures.map((f) => [`${f.stage}:${f.signature}`, f.signature]),
    );
    for (const key of [...failureStreaks.keys()]) {
      if (!thisSignatures.has(key)) failureStreaks.delete(key);
    }
    let abortSignature: string | undefined;
    let abortCount = 0;
    for (const [key, signature] of thisSignatures) {
      const count = (failureStreaks.get(key) ?? 0) + 1;
      failureStreaks.set(key, count);
      if (count >= abortThreshold && count > abortCount) {
        abortSignature = signature;
        abortCount = count;
      }
    }
    if (abortSignature) {
      log.error(
        `[flume] the same failure signature repeated on ${abortCount} ` +
          `consecutive ticks (${abortSignature}); aborting after ${ticks} ` +
          `tick(s) instead of burning the remaining ticks against the same wall.`,
      );
      return {
        ticks,
        hibernated: false,
        repeatedFailure: {
          signature: abortSignature,
          count: abortCount,
        },
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }

    if (exitCode === EX_TERMINAL_MISCONFIG) {
      // Axis-C fail-fast (§3): the child classified a terminal
      // misconfiguration (orphaned awake flags). The decision comes from the
      // exit signal alone — the orphaned flags definitionally defeat
      // `baton.hibernating()`, so it is never consulted here. The flags are
      // still on disk (the child leaves them); read them only to *name* the
      // orphans in the summary.
      const phases = baton.awake();
      log.error(
        `[flume] tick exited ${exitCode} (terminal misconfiguration): ` +
          `orphaned awake flags name unknown phases: ` +
          `${phases.length > 0 ? phases.join(", ") : "(none on disk)"}; ` +
          `stopping after ${ticks} tick(s). Inspect, then ` +
          `\`flume sleep <phase>\` or fix the chain.`,
      );
      return {
        ticks,
        hibernated: false,
        terminal: { kind: "orphaned-awake", phases },
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
    if (exitCode === EX_MOUNT_DEAD) {
      // Mount-dead fail-fast (v0.7 §4): the child could not resolve a chain
      // at all — no agent ran, nothing here is retryable by waiting. A chain
      // that fails to load now is exactly as unloadable next tick as this
      // one, so continuing would only burn the remaining `--max` ticks
      // re-hitting the same wall instead of surfacing the failure to CI.
      log.error(
        `[flume] tick exited ${exitCode} (mount-dead): the chain failed to ` +
          `load; aborting after ${ticks} tick(s) instead of burning the ` +
          `remaining ticks against the same failure. Inspect and restore ` +
          `the chain (or its state root), then re-run.`,
      );
      return {
        ticks,
        hibernated: false,
        mountDead: true,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
    if (exitCode !== 0) {
      log.warn(
        `[flume] tick process exited with code ${exitCode}; ` +
          `supervisor continuing (next tick is a fresh process)`,
      );
      // LOOP-ERRORED-TICKS-SILENT-EXIT: a child that exits non-zero without
      // ever reaching the verdict write — the CJS-context refusal (2), the
      // detached-HEAD/harness-error refusal (1), an uncaught throw out of
      // `Dispatcher.tick` — is still a tick that failed to do work. Left
      // uncounted, `erroredTicks` stays empty and `loopExitCode` reads a run
      // where nothing succeeded as a clean 0. Guarded on `countedAsErrored`
      // so a tick whose verdict already flagged it (belt-and-suspenders, not
      // reachable today since every verdict-errored path exits 0 via
      // `tickExitCode`) isn't double-counted.
      if (!countedAsErrored) {
        erroredTicks.push(
          `tick process exited ${exitCode} with no verdict written to disk`,
        );
      }
    }
    // spec/loop.md "Graceful stop — the stop flag": checked at the same
    // per-iteration boundary as the baton re-read below, never mid-tick —
    // the in-flight tick above always completed (merge, park, verdict, and
    // handoff ran exactly as they would have) before this is reached. A
    // flag written while that tick was running is picked up here, ending
    // the run even though the baton may still carry awake flags — the
    // hibernation check below never gets a chance to end it on its own
    // terms. The flag itself is left on disk; there is no unstop verb.
    if (existsSync(namespacedJoin(join(flumeDir, "stop")))) {
      log.info(`[flume] stop flag present; ending run after ${ticks} tick(s)`);
      await logFrictionSummary();
      return {
        ticks,
        hibernated: baton.hibernating(),
        stoppedByFlag: true,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
    // Disk is truth: the child tick slept its phase and woke successors (or
    // didn't). No awake flags ⇒ hibernation. A failed tick does no baton
    // work, so an unguarded broken chain.ts keeps a phase awake and fails
    // loudly every iteration until restored or --max is hit.
    if (baton.hibernating()) {
      log.info(`[flume] hibernating after ${ticks} tick(s)`);
      await logFrictionSummary();
      return {
        ticks,
        hibernated: true,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
  }
  log.info(`[flume] reached --max ${maxTicks}; stopping`);
  await logFrictionSummary();
  return {
    ticks,
    hibernated: false,
    shippedTags: [...shippedTags],
    erroredTicks,
  };
}

/**
 * Default {@link SuperviseLoopOptions.runTick}: spawn `flume tick` as a fresh
 * process mirroring however the supervisor itself was launched. `execArgv`
 * carries node flags (e.g. `--import tsx` when run from source); `argv[1]` is
 * the cli entrypoint (`dist/cli.js` built, `src/cli.ts` from source).
 * `quarantinedSlugs` (§16, RELEASE-v0.7) crosses the process boundary via the
 * `FLUME_QUARANTINED_SLUGS` env var — the CLI's `tick` command reads it back
 * into `DispatcherOptions.quarantinedSlugs`; omitted entirely when empty.
 * `FLUME_TIP_CLAIM_HELD` (spec/loop.md "The loop lock and the tip claim")
 * carries this supervisor process's own pid — the one that acquired the tip
 * claim in `src/cli.ts`'s `loop` command — so the child tick trusts the
 * claim already held instead of acquiring (and colliding on) its own.
 */
function defaultTickRunner(
  repoRoot: string,
): (
  quarantinedSlugs: ReadonlySet<string>,
) => Promise<{ exitCode: number | null }> {
  return (quarantinedSlugs) =>
    new Promise((resolveExit) => {
      const env = { ...process.env };
      if (quarantinedSlugs.size > 0) {
        env.FLUME_QUARANTINED_SLUGS = [...quarantinedSlugs].join(",");
      }
      env.FLUME_TIP_CLAIM_HELD = String(process.pid);
      const child = spawn(
        process.execPath,
        [...process.execArgv, process.argv[1]!, "tick"],
        { cwd: repoRoot, stdio: "inherit", env },
      );
      child.on("exit", (code) => resolveExit({ exitCode: code }));
      child.on("error", (err) => {
        consoleLogger.error(
          `[flume] failed to spawn 'flume tick': ${(err as Error).message}`,
        );
        resolveExit({ exitCode: 1 });
      });
    });
}

// ---------- module-private utilities ----------

function summarize(
  phaseName: string,
  result: TickResult,
  awaking: string[],
  noCommit?: NoCommitMode,
  tipMoved?: boolean,
  declined?: boolean,
): string {
  const parts: string[] = [phaseName];
  if (result.committed) {
    if (result.shippedTags.length > 0) {
      parts.push(`shipped ${result.shippedTags.join(", ")}`);
    } else if (result.commitSha) {
      parts.push(`committed ${result.commitSha.slice(0, 8)}`);
    }
    // A wave can ship *and* hit the §5 backstop (some entries landed before
    // the ref moved; the rest, or the trailing ledger commit, refused) or
    // the §8 decline (some entries declined while their siblings ran).
    if (tipMoved) parts.push("(tip-moved for part of this tick)");
    if (declined) parts.push("(declined for part of this tick)");
  } else {
    // The §6 mode in the one-liner is the logger record that lets a
    // voluntary-bail loop be told from a platform-preempt run without
    // reading session logs. `tip-moved` (RELEASE-v0.11 §5) and `declined`
    // (RELEASE-v0.11 §8) are reported the same way even though neither is
    // ever a `NoCommitMode` — the one-liner is a rendering, not the typed
    // fact itself.
    parts.push(
      tipMoved
        ? "no commit (tip-moved)"
        : declined
          ? "no commit (declined)"
          : noCommit
            ? `no commit (${noCommit})`
            : "no commit",
    );
  }
  if (awaking.length > 0) parts.push(`→ ${awaking.join(",")}`);
  else parts.push(`→ hibernate`);
  return parts.join(" ");
}

/**
 * Build the §6 voluntary-bail record: the agent exited cleanly without
 * committing. The constraint it refused is its final message, bounded — the
 * build/plan prompts instruct it to name the writablePaths/Rule-0/spec gap
 * there. {@link finalAgentMessage} lifts that message out of a stream-json
 * transcript before bounding, so the refused constraint reaches the retry
 * legibly rather than as escaped-JSON/cost-metadata noise.
 */
function buildVoluntaryBail(stdout: string): VoluntaryBailAttempt {
  const message = finalAgentMessage(stdout);
  return {
    mode: "voluntary-bail",
    constraint:
      message.length > 0
        ? message
        : "(agent exited cleanly without committing and produced no final message naming a constraint)",
  };
}

/**
 * The agent's final message, bounded for the §5 voluntary-bail block.
 *
 * The dogfood `.flume/chain.ts` runs the agent under
 * `withTerminalRenderer(withSessionCapture(claudeCode({ outputFormat:
 * "stream-json" })))`. Those decorators pass stdout through raw, so
 * `AgentResult.stdout` is the stream-json NDJSON transcript, not prose —
 * tailing it raw forwards escaped-JSON assistant/result events plus
 * cost/usage metadata, the exact §6 noise this block is meant to replace
 * with the refused constraint. When stdout parses as stream-json, lift the
 * agent's final message out of the transcript: the terminal `result` event's
 * `result` text (Claude Code puts the final assistant message there
 * verbatim), else the last `assistant` turn's concatenated text blocks. If
 * stream-json was detected but neither event carried text, fall back to the
 * raw transcript tail — never an empty string, which would silently drop
 * the bail's refused constraint (`.claude/rules/engineering.md`, "Loud or
 * nothing"). A plain-text agent (`claudeCode({ outputFormat: "text" })`)
 * emits no stream-json events — its stdout already IS the final message,
 * returned unchanged. Either way the result is `tailBound` to
 * `MAX_PRIOR_NOCOMMIT`: a bail names its constraint at the tail of its
 * closing message.
 */
function finalAgentMessage(stdout: string): string {
  let sawStreamJson = false;
  let resultText: string | undefined;
  let lastAssistantText: string | undefined;

  for (const raw of stdout.split("\n")) {
    const parsed = parseNdjsonLine(raw);
    if (parsed.kind !== "event") continue;
    const e = parsed.event;
    if (typeof e.type !== "string") continue;
    sawStreamJson = true;
    if (isResultEvent(e)) {
      if (typeof e.result === "string" && e.result.trim().length > 0) {
        resultText = e.result.trim();
      }
    } else if (isAssistantEvent(e)) {
      const text = assistantTurnText(e);
      if (text.length > 0) lastAssistantText = text;
    }
  }

  if (!sawStreamJson) {
    // Plain-text agent: stdout already IS the final message.
    return tailBound(stdout.trim(), MAX_PRIOR_NOCOMMIT);
  }
  if (resultText !== undefined || lastAssistantText !== undefined) {
    return tailBound((resultText ?? lastAssistantText) as string, MAX_PRIOR_NOCOMMIT);
  }
  // stream-json parsed but no result/assistant event carried text: fall back
  // to the raw transcript tail rather than losing the bail's constraint.
  return tailBound(stdout.trim(), MAX_PRIOR_NOCOMMIT);
}

/**
 * Concatenated `text` blocks of one stream-json `assistant` event;
 * `tool_use`/`thinking` blocks are dropped (they are not the agent's prose).
 */
export function assistantTurnText(e: NdjsonEvent): string {
  const parts = contentBlocksOfType(e, "text")
    .filter((c) => typeof c.text === "string")
    .map((c) => (c.text as string).trim());
  return parts.join("\n\n").trim();
}

/** Build the §6 platform-preempt record from the non-work failure class. */
function buildPlatformPreempt(failureClass: string): PlatformPreemptAttempt {
  return {
    mode: "platform-preempt",
    failureClass: bound(failureClass, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the RELEASE-v0.10 §3 render-refused record from the render's own
 * {@link InlineExecRenderError} — its `message` already names every failing
 * span's command text and stderr.
 */
function buildRenderRefused(err: InlineExecRenderError): RenderRefusedAttempt {
  return {
    mode: "render-refused",
    failures: bound(err.message, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the RELEASE-v0.11 §5 tip-moved record: the ref this tick found
 * didn't match the tip it recorded at tick start. A sibling to the §6
 * builders above, never a `NoCommitMode` — see {@link TipMovedAttempt}.
 *
 * `observedTip` is always the observed HEAD itself, never its parent — both
 * legs run the same ancestry check now (spec/worktrees.md "Singleton runs in
 * a worktree" retired the singleton leg's own parent-equality check, whose
 * "found" used to name the mismatched commit's parent instead), so the
 * agent's own top commit always stays discoverable rather than reading as
 * the intruder.
 */
function buildTipMoved(expectedTip: string, observedTip: string): TipMovedAttempt {
  return { mode: "tip-moved", expectedTip, observedTip };
}

/**
 * Pickability in the fanout context. The dispatcher's model: a dep is
 * satisfied iff it is no longer in pending (we remove entries on ship).
 * `requiresCapability` is pickable iff the chain's declared `capabilities`
 * (v0.8 §4) asserts the entry's named capability.
 *
 * The foundations governor (§v0.3) runs first: an entry whose `dependsOnForks`
 * contains any unresolved slug is not pickable, regardless of gate kind.
 * `isForkResolved` defaults to always-resolved so the check is a no-op when no
 * resolver is wired or no entry declares a fork dependency.
 */
function isPickable(
  entry: PendingEntry,
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean = () => true,
  capabilities: ReadonlySet<string> = new Set(),
): boolean {
  if (!entry.dependsOnForks.every(isForkResolved)) return false;
  switch (entry.gate.kind) {
    case "open":
      return true;
    case "blockedBy": {
      // Narrow into a local so the closure doesn't lose the discriminator.
      const depTag = entry.gate.tag;
      return !pending.some((e) => e.tag === depTag);
    }
    case "parked":
    case "deferred":
      return false;
    case "requiresCapability":
      return capabilities.has(entry.gate.capability);
  }
}
