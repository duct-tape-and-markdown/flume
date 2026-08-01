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

import type { Agent } from "./Agent.js";
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

/** Bound on a persisted {@link ProvisionFailure.signature} — a comparison key, not a transcript. */
const MAX_PROVISION_SIGNATURE = 500;

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
 *                            touched a declared file — counted shipped.
 *  - `cherry-pick-conflict`  the cherry-pick itself failed; entry stays
 *                            pending, no commit reached trunk.
 *  - `afterMerge-reverted`   landed, then an afterMerge gate failed; that
 *                            entry's commit alone was reset back off trunk.
 *  - `afterCommit-reverted`  reverted inside the worktree by an afterCommit
 *                            gate (§13, RELEASE-v0.7); never reached
 *                            cherry-pick, so it never touched trunk on its
 *                            own.
 *  - `channel-only`          landed and passed every gate, but touched no
 *                            file the entry declared (§12) — stays on
 *                            trunk, entry stays pending (not a ship).
 *  - `tip-moved`             the wave's own commit-onto-trunk step refused
 *                            because the ref moved since this wave started
 *                            or since its own last successful action
 *                            (RELEASE-v0.11 §5) — never reached cherry-pick,
 *                            entry stays pending for a fresh retry against
 *                            the new tip.
 */
export type MergeOutcome =
  | "merged"
  | "cherry-pick-conflict"
  | "afterMerge-reverted"
  | "afterCommit-reverted"
  | "channel-only"
  | "tip-moved";

/**
 * One fanout entry's {@link MergeOutcome}, as recorded in a {@link
 * TickVerdict}. `footprint` is the entry's actual touched paths — present
 * on the outcomes that never landed cleanly on trunk (`cherry-pick-conflict`,
 * `afterMerge-reverted`, `afterCommit-reverted`) where a captured diff
 * exists; absent when the outcome carries no footprint of its own (`merged`,
 * `channel-only`, or a best-effort capture that failed). `commitPendingUpdate`
 * sources a wave's footprint commit from this same field (v0.8 §5: "now
 * generated from the same verdict record rather than separate capture") —
 * no independently-maintained observed-files map.
 */
export interface TickVerdictMergeOutcome {
  tag: string;
  outcome: MergeOutcome;
  footprint?: string[];
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
  /** Every gate that ran this tick, in run order, across every entry. */
  gateResults: TickVerdictGateResult[];
  /** Entry tags shipped by this tick (§12 declared-files diff already applied); empty for a singleton phase. */
  shippedTags: string[];
  /** Fanout only; empty for a singleton phase or a wave with nothing provisioned. */
  mergeOutcomes: TickVerdictMergeOutcome[];
  /**
   * §16 (RELEASE-v0.7): pre-tick worktree provisioning failures (sweep or
   * create) this tick recorded, before any agent ran for the affected
   * entries. Absent/empty when the tick hit none.
   */
  provisionFailures?: ProvisionFailure[];
  /** This tick's one-line logger summary, verbatim — a rendering of the facts above, not a judgment of them. */
  summary: string;
}

/** Shared return shape for {@link Dispatcher.runSingleton} and {@link Dispatcher.runFanout}. */
type PhaseTickOutcome = {
  result: TickResult;
  noCommit?: NoCommitMode;
  /** RELEASE-v0.11 §5: sibling to `noCommit` — see {@link TickVerdict.tipMoved}. */
  tipMoved?: boolean;
  provisionFailures?: ProvisionFailure[];
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
  await mkdir(flumeDir, { recursive: true });
  await writeFile(tickVerdictPath(flumeDir), JSON.stringify(verdict), "utf8");
  const history = await readTickVerdicts(flumeDir);
  const bounded = [...history, verdict].slice(-MAX_TICK_VERDICTS);
  await writeFile(
    tickVerdictsLogPath(flumeDir),
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
  await rm(tickVerdictPath(flumeDir), { force: true });
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
  const p = tickVerdictPath(flumeDir);
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
  const p = tickVerdictsLogPath(flumeDir);
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
  return verdicts.slice(-n);
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
 * How an agent invocation ended — consulted by §6 classification ONLY when
 * the tick produced no commit. A clean exit with no commit is a
 * voluntary-bail (the agent refused a constraint and said so in its final
 * message, captured here as `stdout`); any process failure is a
 * platform-preempt (not a defect in the work). When a commit landed, how the
 * process ended is irrelevant — the commit is honored regardless.
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
 * branch-name, `harvestFriction`'s `` `${tag}--${file.name}` ``) is looser
 * and stays within filesystem NAME_MAX (255) by construction as a result.
 * Agreement between the two sides is pinned by tests/Dispatcher.test.ts,
 * "revert note to the friction channel (§5)", not asserted here.
 */
function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
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
 * The friction count line shared by `flume status`, `flume job status`, and
 * the loop-end summary (§6, v0.6.2): count of files directly under the
 * declared friction dir, resolved against `stateRoot` — whichever state
 * root is in play for the caller (the repo's `flumeDir`, or a job's dir).
 * `undefined` when `Chain.friction` is undeclared, the dir is absent, or it
 * holds no files — callers print a line only when this resolves to a
 * string (§6: "when declared and non-empty").
 */
export async function frictionCountLine(
  stateRoot: string,
  chain: Chain,
): Promise<string | undefined> {
  if (chain.friction === undefined) return undefined;
  let entries: Dirent[];
  try {
    // win32 total-path limit (~260 chars, v0.4 §6): same join(stateRoot,
    // chain.friction) construction writeRevertNote and harvestFriction
    // guard below — namespacedJoin (src/paths.ts) is the shared idiom.
    entries = await readdir(namespacedJoin(stateRoot, chain.friction), {
      withFileTypes: true,
    });
  } catch {
    return undefined;
  }
  const count = entries.filter((e) => e.isFile()).length;
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
  if (!existsSync(path)) {
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
        `Default-exporting a Chain object is the pre-0.11 shape — wrap it in a ` +
        `factory and take engine values from the parameter instead of importing ` +
        `them (see docs/MIGRATING-0.11.md).`,
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
  const result: ChainModule = { chain };
  if (module.agent) result.agent = module.agent;
  if (module.forkResolver) result.forkResolver = module.forkResolver;
  return result;
}

/**
 * Build the default per-tick chain resolver: load `<configDir>/chain.ts` via
 * `loadChainModule`, once per call. No memoization — each `flume tick` is a
 * fresh process (§2), so there is exactly one resolution per process and
 * nothing to memoize across. The prior content-hash cache was an in-process
 * optimization for a mechanism (in-process reload) that cannot deliver the
 * re-resolution guarantee; cost is one small `tsImport` per tick, dominated
 * by orders of magnitude by the agent invocation.
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
  /** Max parallel ticks per fanout batch. Default 4. */
  maxParallel?: number;
  /**
   * Wall-clock timeout per agent invocation in milliseconds. When exceeded,
   * the underlying agent process is aborted; the dispatcher logs a warning
   * and the tick continues with whatever the agent committed (typically
   * nothing, so the phase falls through with `committed: false`). Default:
   * unset — a hung agent will block the tick indefinitely.
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
   * v0.8 §5: this tick's unified facts artifact, present iff a phase
   * actually ran (same condition as `result`) — absent on `hibernated`,
   * `failed`, `usageError`, or `terminal`. The CLI's `tick` command persists
   * this via `writeTickVerdict`; `Dispatcher.tick()` itself never writes to
   * disk, so a plain unit test calling it directly gains no untracked side
   * effect.
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
          ? await this.runSingleton(phase, agent)
          : await this.runFanout(phase, agent, chain, forkResolver);
    } catch (err) {
      if (!(err instanceof PendingParseFailure)) throw err;
      // Same failure class as an unresolved chain (v0.7 §4): no agent ran
      // (singleton/fanout's decide-read refused before invoking one) or a
      // wave's shipped work landed on trunk but the rewrite that would clear
      // it from pending.json refused rather than deriving `[]` from a parse
      // it never trusted — either way this tick does no more work, and a
      // fresh process next tick reads the same unparseable file until a
      // human fixes it.
      this.log.error(`[flume] ${err.message}`);
      return {
        hibernated: false,
        failed: true,
        awakeAfter: this.baton.awake(),
        summary: err.message,
      };
    }
    const { result, noCommit, tipMoved, provisionFailures, tags, mergeOutcomes } =
      phaseOutcome;

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

    const summary = summarize(phase.name, result, allowed, noCommit, tipMoved);

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
      gateResults: [...result.gateResults] as TickVerdictGateResult[],
      shippedTags: [...result.shippedTags],
      mergeOutcomes: mergeOutcomes ?? [],
      ...(provisionFailures && provisionFailures.length > 0
        ? { provisionFailures }
        : {}),
      summary,
    };

    return {
      hibernated: false,
      phaseName: phase.name,
      result: resultForHandoff,
      verdict,
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(provisionFailures && provisionFailures.length > 0
        ? { provisionFailures }
        : {}),
      awakeAfter: this.baton.awake(),
      summary,
    };
  }

  // ---------- singleton tick ----------

  private async runSingleton(
    phase: Phase,
    agent: Agent,
  ): Promise<PhaseTickOutcome> {
    const cwd = this.opts.repoRoot;
    const preHead = await git.revParse(cwd);
    const pending = await this.readPending();

    const key = this.priorAttemptKey(phase);
    const prior = await this.readPriorAttempt(key);

    const ctx: TickContext = { cwd, flumeDir: this.flumeDir, pending };
    const args = phase.promptArgs?.(ctx) ?? {};

    let prompt: string;
    try {
      prompt = await renderPrompt({
        phase,
        flumeDir: this.flumeDir,
        promptFile: join(this.opts.configDir, phase.promptPath),
        cwd,
        args,
        ...(prior ? { priorAttempt: prior } : {}),
      });
    } catch (err) {
      if (!(err instanceof InlineExecRenderError)) throw err;
      // RELEASE-v0.10 §3: an unresolved inline-exec span aborts the render —
      // the agent is never invoked. Distinct from voluntary-bail/
      // platform-preempt: no agent ran at all.
      await this.writePriorAttempt(key, buildRenderRefused(err));
      this.log.warn(`[flume] ${phase.name}: render-refused (no commit): ${err.message}`);
      return {
        result: {
          phaseName: phase.name,
          committed: false,
          gateResults: [],
          pendingAfter: pending,
          shippedTags: [],
          revertedTags: [],
        },
        noCommit: "render-refused",
      };
    }

    const termination = await this.invokeAgent(phase, cwd, prompt, agent);

    const postHead = await git.revParse(cwd);
    let committed = postHead !== preHead;
    const gateResults: GateResultEntry[] = [];
    let noCommit: NoCommitMode | undefined;
    let tipMoved = false;

    if (committed) {
      // RELEASE-v0.11 §5 tip verify: the agent commits directly, so the
      // dispatcher never sees the moment of commit — verify after the fact
      // instead. The commit's own parent must be the tip this tick recorded
      // at start; a mismatch means the ref moved (an operator committing
      // mid-tick, a pull, a claim-less bare-tick collision) while the agent
      // ran. Checked before any gate runs — a commit on the wrong parent is
      // refused regardless of what the gates would have said.
      const parent = await git.revParse(cwd, `${postHead}^`);
      if (parent !== preHead) {
        await this.revertTipMovedCommit(cwd, postHead);
        committed = false;
        tipMoved = true;
        await this.writePriorAttempt(key, buildTipMoved(preHead, parent));
        this.log.warn(
          `[flume] ${phase.name}: tip moved (no commit) — expected ${preHead}, found ${parent}`,
        );
      }
    }

    if (committed) {
      const verdict = await this.runAfterCommitGates(phase, cwd, postHead);
      gateResults.push(...verdict.results);
      if (!verdict.ok) {
        // Capture the §5 record AND the §8 prose snapshot while the reverted
        // commit is still reachable, then drop it. The next tick is a fresh
        // process — these disk artifacts are the only carry. The snapshot is
        // what keeps a reverted *plan* tick's state.md / open-questions.md
        // findings recoverable without session logs (§8): the `git reset
        // --hard` below would otherwise destroy them, leaving hand-recovery
        // from `.flume/sessions/` the only path (the `5f4b583` →
        // hand-reconstructed-in-`9432489` incident).
        const record = await this.buildPriorAttempt(
          "afterCommit",
          verdict.failure!,
          cwd,
          postHead,
        );
        await this.snapshotRevertedFiles(cwd, postHead, key);
        await git.dropLastCommit(cwd, postHead);
        committed = false;
        noCommit = "gate-revert";
        await this.writePriorAttempt(key, record);
        this.log.warn(
          `[flume] ${phase.name} commit reverted: ${verdict.failure?.message}`,
        );
      }
    }

    if (committed) {
      // A clean ship clears the slot so the next tick starts with no stale
      // prior-attempt signal.
      await this.clearPriorAttempt(key);
    } else if (!tipMoved && !noCommit) {
      // No commit and no gate ran: classify the agent's own termination
      // (§6). A clean exit that produced nothing is a voluntary-bail (the
      // agent refused a constraint and named it in its final message); any
      // process failure is a platform-preempt (not a defect in the work).
      // `tipMoved` already wrote its own §5 record above — the §6 taxonomy
      // never applies to it (it's not a NoCommitMode).
      noCommit = await this.classifyNoCommit(key, termination);
      this.log.warn(`[flume] ${phase.name}: ${noCommit} (no commit)`);
    }

    return {
      result: {
        phaseName: phase.name,
        committed,
        ...(committed ? { commitSha: postHead } : {}),
        gateResults,
        pendingAfter: await this.readPendingTolerant(),
        shippedTags: [],
        revertedTags: [],
      },
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
    };
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
    const batches = partitionByFileOverlap(pickable, {
      maxParallel: this.maxParallel,
    });
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
      const signature = bound(message.trim(), MAX_PROVISION_SIGNATURE);
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
    const worktrees: Array<{ path: string; branch: string }> = [];
    const provisioned: PendingEntry[] = [];
    for (const entry of batch) {
      try {
        worktrees.push(await this.createWorktree(entry, preHead));
        provisioned.push(entry);
      } catch (err) {
        const message = (err as Error).message;
        const signature = bound(message.trim(), MAX_PROVISION_SIGNATURE);
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
    const extraEnvByIndex: Array<Record<string, string> | undefined> =
      worktrees.map(() => undefined);
    if (phase.setupWorktree) {
      const setupResults = await Promise.all(
        provisioned.map((entry, i) =>
          phase.setupWorktree!({
            worktreePath: worktrees[i]!.path,
            repoRoot,
            entryTag: entry.tag,
          }),
        ),
      );
      for (let i = 0; i < setupResults.length; i++) {
        const r = setupResults[i];
        if (r && r.extraEnv) extraEnvByIndex[i] = r.extraEnv;
      }
    }

    // Run agent in each worktree concurrently.
    const perEntry = await Promise.all(
      provisioned.map((entry, i) =>
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
    // RELEASE-v0.11 §5 tip verify: the tip this wave's cherry-picks may
    // legitimately land on — `preHead` for the first, advanced to each
    // successful merge's sha as the wave makes its own progress. Distinct
    // from "moved": our own cherry-picks advancing trunk is expected;
    // anything else showing up here is external interference. A wave that
    // hits it at all sets the wave-level `tipMoved` fact even when it also
    // ships (entries already merged before the interference stay shipped —
    // same per-entry isolation §7b's afterMerge revert already established).
    let expectedTip = preHead;
    let waveTipMoved = false;

    for (const r of perEntry) {
      if (r.tipMoved) waveTipMoved = true;
      if (!r.committed || !r.commitSha) {
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
          });
        }
        continue;
      }

      const preCherry = await git.revParse(repoRoot);
      if (preCherry !== expectedTip) {
        // §5: trunk moved since this wave's last known-good state — an
        // operator commit, a pull, a claim-less collision. Refuse to
        // cherry-pick onto it; the entry's worktree commit never reaches
        // trunk and stays pending for a fresh retry against the new tip.
        // `expectedTip` is left unchanged, so every remaining entry this
        // wave hits the same refusal (the interference doesn't undo itself).
        this.log.warn(
          `[flume] ${phase.name}: tip moved before cherry-picking ${r.entry.tag} (expected ${expectedTip}, found ${preCherry}); entry stays pending`,
        );
        waveTipMoved = true;
        mergeOutcomes.push({ tag: r.entry.tag, outcome: "tip-moved" });
        continue;
      }
      try {
        await git.cherryPick(repoRoot, r.commitSha);
      } catch (err) {
        this.log.warn(
          `[flume] cherry-pick failed for ${r.entry.tag}: ${(err as Error).message}; entry stays in pending`,
        );
        let footprint: string[] | undefined;
        try {
          footprint = await git.showNameOnly(repoRoot, r.commitSha);
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
        });
        continue;
      }
      const mergedSha = await git.revParse(repoRoot);

      // Gate this entry's merged commit. The first failing afterMerge gate
      // attributes the failure to *this* entry — it is the only delta
      // between `preCherry` and `mergedSha`.
      // Computed once per commit and shared across every gate this loop
      // runs, and reused below for the footprint/declared-file checks that
      // need the identical commit's touched paths — same dedup as
      // runAfterCommitGates above.
      const commitTouchedPaths = await git.showNameOnly(repoRoot, mergedSha);
      let entryFailure:
        | { gate: string; message: string; details?: string }
        | undefined;
      for (const gate of afterMergeGates) {
        const gr = await gate.run({
          cwd: repoRoot,
          repoRoot,
          flumeDir: this.flumeDir,
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
        await git.hardResetTo(repoRoot, preCherry);
        mergeReverted.push(r.entry);
        mergeOutcomes.push({
          tag: r.entry.tag,
          outcome: "afterMerge-reverted",
          footprint: commitTouchedPaths,
        });
        continue;
      }

      this.log.info(
        `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
      );

      // §12: landing on trunk isn't shipping — a commit that only touches
      // phase.entryChannelPaths (a park note, no implementation) must not
      // clear the entry from pending.json. Diff against the entry's
      // *declared* files.{new,edit,retire}, not touchedPaths() — that
      // folds in observedFiles, a downstream footprint signal, not proof
      // this diff shipped real work. `commitTouchedPaths` (above) is the
      // raw commit diff, not that folded signal, so reusing it here is safe.
      const declaredFiles = declaredPaths(r.entry);
      const touchesDeclaredFile = commitTouchedPaths.some((p) =>
        declaredFiles.includes(p),
      );
      if (!touchesDeclaredFile) {
        this.log.warn(
          `[flume] ${r.entry.tag}: cherry-picked ${mergedSha.slice(0, 8)} touches no declared file — entry stays pending (channel-only commit)`,
        );
        mergeOutcomes.push({ tag: r.entry.tag, outcome: "channel-only" });
        continue;
      }

      shipped.push(r.entry);
      mergeOutcomes.push({ tag: r.entry.tag, outcome: "merged" });
      // Our own successful cherry-pick is the wave's new known-good tip —
      // the next entry's `preCherry` is expected to land here, not `preHead`.
      expectedTip = mergedSha;
    }

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
      const update = await this.commitPendingUpdate(
        shippedTags,
        mergeOutcomes,
        expectedTip,
      );
      const updSha = update.sha;
      if (updSha !== preUpdate) chorSha = updSha;
      if (update.tipMoved) {
        waveTipMoved = true;
        this.log.warn(
          `[flume] ${phase.name}: tip moved before the pending-ledger commit (expected ${expectedTip}, found ${updSha}); pending.json left untouched — shipped entries already on trunk stay shipped`,
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
      await this.harvestFriction(chain, wt.path, tag);
      try {
        await git.removeWorktree(repoRoot, wt.path);
        cleaned++;
      } catch (err) {
        survivingPaths.push(wt.path);
      }
      await git.deleteBranch(repoRoot, wt.branch);
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

    const allGateResults = perEntry
      .flatMap((r) => r.gateResults)
      .concat(mergeGateResults);

    const committedWave = shipped.length > 0;

    // Wave-level §6 cause, only when the wave shipped nothing usable.
    // Per-entry modes are already persisted to each entry's own §5 record
    // (the durable channel §6 mandates); this is the single representative
    // label for the logger/TickOutcome. Precedence gate-revert >
    // render-refused > platform-preempt > voluntary-bail: gate-revert means
    // work was produced and lost (highest signal); render-refused (§3) is a
    // real defect in the prompt/config, ranked above the non-defect classes;
    // platform-preempt outranks voluntary-bail so a rate-limited wave is not
    // misread as the agents bailing — §6's explicit "platform failures
    // masquerade as agent failures" harm.
    let waveNoCommit: NoCommitMode | undefined;
    if (!committedWave) {
      const modes = new Set<NoCommitMode>(
        perEntry.flatMap((r) => (r.noCommit ? [r.noCommit] : [])),
      );
      // Per-entry afterMerge isolation (§7b) wrote a gate-revert §5 record
      // for each merge-reverted entry; reflect that in the wave-level cause.
      if (mergeReverted.length > 0) modes.add("gate-revert");
      waveNoCommit = modes.has("gate-revert")
        ? "gate-revert"
        : modes.has("render-refused")
          ? "render-refused"
          : modes.has("platform-preempt")
            ? "platform-preempt"
            : modes.has("voluntary-bail")
              ? "voluntary-bail"
              : undefined;
    }

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
      ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
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
    gateResults: GateResultEntry[];
    /** §6 mode when this entry produced no usable commit; absent when it shipped. */
    noCommit?: NoCommitMode;
    /** RELEASE-v0.11 §5: sibling to `noCommit`, set when this entry's own worktree commit landed on a moved tip. */
    tipMoved?: boolean;
    /**
     * §13 (RELEASE-v0.7): the reverted commit's actual touched paths, captured
     * before `dropLastCommit` discards it — set only on an in-worktree
     * `afterCommit` gate revert, so the wave loop can feed it into `observed`
     * the same way an `afterMerge` failure's footprint is fed in.
     */
    footprint?: string[];
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
      await this.writePriorAttempt(key, buildRenderRefused(err));
      this.log.warn(`[flume] ${entry.tag}: render-refused (no commit): ${err.message}`);
      return { entry, committed: false, gateResults: [], noCommit: "render-refused" };
    }

    const preHead = await git.revParse(wt.path);
    const termination = await this.invokeAgent(
      phase,
      wt.path,
      prompt,
      agent,
      extraEnv,
    );
    const postHead = await git.revParse(wt.path);
    let committed = postHead !== preHead;

    if (committed) {
      // RELEASE-v0.11 §5 tip verify: same idiom as the singleton callsite —
      // the agent commits directly in this worktree, so verify after the
      // fact that its commit's parent is the tip this entry's worktree was
      // provisioned from. The worktree's own branch is private to this
      // entry/tick, so a mismatch here means something reset or rewrote it
      // out from under the agent mid-run, not routine external traffic.
      const parent = await git.revParse(wt.path, `${postHead}^`);
      if (parent !== preHead) {
        await this.revertTipMovedCommit(wt.path, postHead);
        await this.writePriorAttempt(key, buildTipMoved(preHead, parent));
        this.log.warn(
          `[flume] ${entry.tag}: tip moved (no commit) — expected ${preHead}, found ${parent}`,
        );
        return { entry, committed: false, gateResults: [], tipMoved: true };
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
      return { entry, committed: false, gateResults, noCommit: mode };
    }

    const verdict = await this.runAfterCommitGates(
      phase,
      wt.path,
      postHead,
      entry,
    );
    gateResults.push(...verdict.results);
    if (!verdict.ok) {
      const record = await this.buildPriorAttempt(
        "afterCommit",
        verdict.failure!,
        wt.path,
        postHead,
      );
      await this.writeRevertNote(
        chain,
        wt.path,
        postHead,
        entry,
        verdict.failure!,
      );
      // §13: this revert never reaches cherry-pick, so it's the only chance
      // to capture what the commit actually touched — grab it before
      // dropLastCommit discards the evidence.
      let footprint: string[] | undefined;
      try {
        footprint = await git.showNameOnly(wt.path, postHead);
      } catch {
        // Best-effort, as elsewhere — the retry just partitions on declared
        // files as before if this fails.
      }
      await git.dropLastCommit(wt.path, postHead);
      await this.writePriorAttempt(key, record);
      this.log.warn(
        `[flume] ${entry.tag}: commit reverted (${verdict.failure?.message})`,
      );
      return {
        entry,
        committed: false,
        gateResults,
        noCommit: "gate-revert",
        ...(footprint ? { footprint } : {}),
      };
    }

    return {
      entry,
      committed: true,
      commitSha: postHead,
      gateResults,
    };
  }

  // ---------- helpers ----------

  /**
   * RELEASE-v0.11 §5 tip verify, for a commit the agent made itself
   * (singleton, or a fanout entry's per-worktree commit — the dispatcher
   * never sees the moment of commit in either case, so it verifies after the
   * fact: the commit's own parent must be the tip this tick recorded at
   * start). `expectedSha` is `postHead`, the commit this call's own caller
   * just observed.
   *
   * Mirrors `git.dropLastCommit`'s guarded-revert idiom — §5 cites it as its
   * own precedent — reconfirming the tip is still `expectedSha` immediately
   * before resetting, so a second race (the ref moving again in the gap
   * between observing `postHead` and reverting it) refuses loudly rather
   * than silently dropping a commit this call never observed at the tip.
   * Soft, not hard, unlike `dropLastCommit`: the agent's work was never at
   * fault, so it survives as uncommitted changes (§5 "agent output stays on
   * disk") rather than being discarded.
   */
  private async revertTipMovedCommit(
    cwd: string,
    expectedSha: string,
  ): Promise<void> {
    const currentTip = await git.revParse(cwd);
    if (currentTip !== expectedSha) {
      throw new Error(
        `tip-verify revert refused: current tip ${currentTip} does not ` +
          `match expected ${expectedSha} — this call did not observe the ` +
          `commit at the current tip, refusing to reset`,
      );
    }
    await git.softReset(cwd, 1);
  }

  private async invokeAgent(
    phase: Phase,
    cwd: string,
    prompt: string,
    agent: Agent,
    extraEnv?: Record<string, string>,
  ): Promise<AgentTermination> {
    try {
      const result = await agent.invoke({
        cwd,
        prompt,
        ...(this.tickTimeoutMs !== undefined
          ? { timeoutMs: this.tickTimeoutMs }
          : {}),
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
  ): Promise<{
    ok: boolean;
    /** First failing gate, structured so callers can persist a §5 record. */
    failure?: { gate: string; message: string; details?: string };
    results: GateResultEntry[];
  }> {
    // Entry-scoped write guard (§5): a fanout tick's allowance narrows to the
    // assigned entry's declared files ∪ the phase's channel globs, with the
    // phase-wide globs as the outer ceiling. Singleton ticks (no entry) keep
    // phase-wide scope. `observedFiles` is deliberately excluded — it feeds
    // the partition, not the write allowance.
    const gates: Gate[] = [
      ...phase.gates.filter((g) => g.when === "afterCommit"),
      writablePathsGate(
        phase.writablePaths,
        assignedEntry
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
    const commitTouchedPaths = await git.showNameOnly(cwd, commitSha);
    const results: GateResultEntry[] = [];
    for (const gate of gates) {
      const r: GateResult = await gate.run({
        cwd,
        repoRoot: cwd,
        flumeDir: this.flumeDir,
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
        };
      }
    }
    return { ok: true, results };
  }

  /**
   * §4 (RELEASE-v0.6.2): before a fanout worktree is torn down, move every
   * file its declared friction channel holds into the primary friction dir,
   * prefixed `<tag>--` for provenance and collision-freedom. Harvest is
   * harness code crossing the worktree boundary (the sessions precedent),
   * not an agent write — worktree agents still only ever write under their
   * own `$PWD`.
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
      // win32 total-path limit (~260 chars, v0.4 §6): mirrorDir nests a
      // worktree path (itself at least as deep as the job dir, v0.4 §6's
      // own createWorktree comment) under chain.friction, so it can exceed
      // MAX_PATH even where no single component does. namespacedJoin
      // (src/paths.ts) is the shared idiom — same as writeRevertNote below.
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
    const files = entries.filter((e) => e.isFile());
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

    for (const file of files) {
      const src = join(mirrorDir, file.name);
      const dest = join(primaryDir, `${tag}--${file.name}`);
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

  private async createWorktree(
    entry: PendingEntry,
    fromRef: string,
  ): Promise<{ path: string; branch: string }> {
    const slug = slugify(entry.tag);
    // Job-scoped branch namespace (v0.5 §4): with a namespace, identical tag
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
    // FLUME_WORKTREES_DIR two jobs with identical tag slugs would otherwise
    // collide on <base>/<slug>, and the stale-cleanup below would rm the
    // OTHER job's live worktree. Namespaced unconditionally when set — the
    // redundant level under a default per-job base is harmless.
    const path = this.opts.namespace
      ? join(wtBase, this.opts.namespace, slug)
      : join(wtBase, slug);
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
    return { path, branch };
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
        // win32 total-path limit (~260 chars, v0.4 §6): dest depth here is
        // driven by the reverted diff's own path depth, not chain.friction,
        // but it's the same join(dir, rel) unwrapped shape writeRevertNote/
        // harvestFriction guard. toNamespacedPath prepends the \\?\
        // extended-length prefix on win32 (no-op elsewhere), same idiom.
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
   * §5 (RELEASE-v0.6.2): when an afterCommit gate reverts a fanout entry's
   * commit and `Chain.friction` is declared, write the operator's copy of
   * the verdict — the gate name/message/details plus the reverted commit's
   * subject+body — to `<friction>/<ISO-timestamp>--<tag>--reverted.md`
   * before `git.dropLastCommit` discards the evidence. Written straight to
   * the primary friction dir (harness code reaching into `flumeDir`, the
   * sessions/harvest precedent) rather than the worktree-local mirror —
   * this runs mid-wave, well before that worktree's own teardown harvest.
   *
   * Undeclared `chain.friction` is a no-op, per §2. Best-effort: a
   * note-write failure must never block the revert it is documenting.
   */
  private async writeRevertNote(
    chain: Chain,
    cwd: string,
    sha: string,
    entry: PendingEntry,
    failure: { gate: string; message: string; details?: string },
  ): Promise<void> {
    if (chain.friction === undefined) return;
    try {
      const { subject, body } = await this.capturedCommitMessage(cwd, sha);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const primaryDir = join(this.flumeDir, chain.friction);
      // win32 total-path limit (~260 chars, v0.4 §6): TAG_MAX_LENGTH bounds
      // only the filename component, not the friction dir's full depth.
      // namespacedJoin (src/paths.ts) is the shared idiom — the mkdir/
      // writeFile below survive a full path past MAX_PATH even when the
      // per-component bound holds.
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
        namespacedJoin(primaryDir, `${stamp}--${entry.tag}--reverted.md`),
        lines.join("\n"),
        "utf8",
      );
    } catch (err) {
      this.log.warn(
        `[flume] ${entry.tag}: revert note write failed: ${(err as Error).message}`,
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
        ? { details: bound(failure.details, MAX_PRIOR_DETAILS) }
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
   * Strict reader: throws {@link PendingParseFailure} on a parse error rather
   * than degrading to `[]`. Used at every read this dispatcher acts on — the
   * singleton/fanout decide-reads and `commitPendingUpdate`'s rewrite read
   * (engineering.md "Loud or nothing": a decision or a rewrite must never
   * derive from an input that failed to resolve). `readPendingTolerant`
   * below is the one declared exception, for the two report-only reads.
   */
  private async readPending(): Promise<PendingEntry[]> {
    if (!existsSync(this.pendingPath)) return [];
    const raw = await readFile(this.pendingPath, "utf8");
    const r = parsePending(raw, this.entryExtension);
    if (!r.ok) throw new PendingParseFailure(r.errors);
    return r.entries;
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
    if (!existsSync(this.pendingPath)) return [];
    const raw = await readFile(this.pendingPath, "utf8");
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
   * `expectedTip` (RELEASE-v0.11 §5): the wave's own running tip — `preHead`
   * if no cherry-pick landed this wave, else the last one's `mergedSha` —
   * checked against a fresh read immediately before this method's own
   * harness-driven `commitPaths` call, the wave's other tip-verify site
   * beside `cherryPick` (`runFanout`, above). Checked before `writeFile`:
   * a refusal here leaves pending.json untouched on disk rather than a
   * write with no commit behind it.
   */
  private async commitPendingUpdate(
    shippedTags: string[],
    mergeOutcomes: readonly TickVerdictMergeOutcome[],
    expectedTip: string,
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
    const existing = await readFile(this.pendingPath, "utf8").catch(() => "");
    if (serialized === existing) {
      return { sha: await git.revParse(this.opts.repoRoot), tipMoved: false };
    }
    // A relocated flumeDir puts pendingPath outside the repo, where staging
    // it would fatal — after the entries already merged. An out-of-tree dock
    // is invisible to git by construction, so no chore commit is wanted: the
    // disk write alone carries the auto-unblock and observedFiles forward —
    // computed before the tip check below, which only guards the git-commit
    // path this dock never takes.
    const rel = relative(this.opts.repoRoot, this.pendingPath);
    const relocated = rel.startsWith("..") || isAbsolute(rel);

    if (!relocated) {
      // RELEASE-v0.11 §5 tip verify, re-read immediately before this
      // method's own commit — the wave's other harness-driven commit
      // besides `cherryPick`. Checked before `writeFile`: a refusal here
      // leaves pending.json untouched on disk, never a write with no commit
      // behind it. Shipped entries this wave already cherry-picked stay
      // shipped regardless — only the ledger update itself is refused.
      const currentTip = await git.revParse(this.opts.repoRoot);
      if (currentTip !== expectedTip) {
        return { sha: currentTip, tipMoved: true };
      }
    }

    await mkdir(dirname(this.pendingPath), { recursive: true });
    await writeFile(this.pendingPath, serialized, "utf8");
    if (relocated) {
      return { sha: await git.revParse(this.opts.repoRoot), tipMoved: false };
    }
    // Scoped to pending.json — `git add -A` would sweep up untracked worktree
    // metadata and unrelated user changes into the harness's chore commit.
    const sha = await git.commitPaths({
      cwd: this.opts.repoRoot,
      message:
        shippedTags.length > 0
          ? `chore(flume): ship ${shippedTags.join(", ")}`
          : `chore(flume): record merge-failure footprints for ${[...observed.keys()].join(", ")}`,
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
   * quarantine (RELEASE-v0.7). `"none"` disables per-entry quarantine
   * outright — a tagged provisioning failure is never withheld from later
   * ticks this run — while the consecutive-identical-failure backstop
   * (`abortThreshold` below) still applies. Default `"run"` is
   * byte-identical to v0.7 §16: quarantine a tagged failure's slug for the
   * rest of the run. The CLI forwards this from the resolved chain's
   * `supervisorPolicy.quarantineScope` (`src/Phase.ts`); undeclared falls
   * through to the default here.
   */
  quarantineScope?: "run" | "none";
  /**
   * §8: chain-declared override for §16's consecutive-identical-failure
   * abort threshold (RELEASE-v0.7) — the number of consecutive ticks the
   * same provisioning-failure signature must repeat, with no successful
   * tick between them, before the run aborts. Default 3 is byte-identical
   * to v0.7 §16. The CLI forwards this from the resolved chain's
   * `supervisorPolicy.abortThreshold`; undeclared falls through to the
   * default here.
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
   * §16 (RELEASE-v0.7): set when the run aborted because the same
   * provisioning-failure signature repeated on `abortThreshold` (default 3,
   * v0.8 §8) consecutive ticks with no successful tick between them — the
   * consecutive-failure backstop for
   * non-entry-scoped provisioning walls the run-scoped quarantine can't
   * isolate (generalizes §4's mount-dead abort past its class without
   * touching §4's own semantics). Distinct from `mountDead` — the chain
   * resolved and ran fine; only pre-tick worktree provisioning kept hitting
   * the identical wall.
   */
  repeatedFailure?: { signature: string; count: number };
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
 * by `maxTicks` (the `--max N` cap); observable `--max`/hibernation behavior
 * is unchanged from the prior in-process loop.
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
  let lastProvisionSignature: string | undefined;
  let provisionFailureStreak = 0;
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
    // that also shipped something, unlike the provisioning leg below, since
    // it signals something else is writing to this ref), or a provisioning
    // failure that left nothing shipped — never a `voluntary-bail` (the
    // agent correctly declining and naming the constraint is not evidence
    // anything went wrong).
    const verdict = await readTickVerdict(flumeDir);
    if (verdict) {
      for (const tag of verdict.shippedTags) shippedTags.add(tag);
      const verdictProvisionFailures = verdict.provisionFailures ?? [];
      const errored =
        verdict.noCommit === "gate-revert" ||
        verdict.noCommit === "platform-preempt" ||
        verdict.noCommit === "render-refused" ||
        verdict.tipMoved === true ||
        (verdictProvisionFailures.length > 0 &&
          verdict.shippedTags.length === 0);
      if (errored) {
        erroredTicks.push(
          verdictProvisionFailures.length > 0
            ? `${verdict.summary} — worktree provisioning failed: ${verdictProvisionFailures
                .map((f) => (f.tag ? `${f.tag} (${f.signature})` : f.signature))
                .join("; ")}`
            : verdict.summary,
        );
      }
    }

    // §16: quarantine every tagged provisioning failure this tick named —
    // isolating the slug so the rest of the run stops re-attempting a wall
    // it already hit once — then fold the tick's failure(s) into the
    // consecutive-identical-signature streak (the backstop for the
    // non-entry-scoped class quarantine can't isolate, e.g. a repo-level
    // `git worktree prune` failure). A tick with no provisioning failure at
    // all clears the streak — only an unbroken run of the identical wall
    // counts. §8: a chain declaring `quarantineScope: "none"` opts out of
    // this leg entirely — the backstop below still fires.
    const provisionFailures = verdict?.provisionFailures ?? [];
    if (quarantineScope !== "none") {
      for (const f of provisionFailures) {
        if (!f.tag) continue;
        const slug = slugify(f.tag);
        if (!quarantinedSlugs.has(slug)) {
          quarantinedSlugs.add(slug);
          log.warn(
            `[flume] quarantining ${f.tag} for the rest of this run: pre-tick ` +
              `worktree provisioning failed (${f.signature})`,
          );
        }
      }
    }
    const thisSignature = provisionFailures[0]?.signature;
    if (thisSignature && thisSignature === lastProvisionSignature) {
      provisionFailureStreak++;
    } else {
      provisionFailureStreak = thisSignature ? 1 : 0;
      lastProvisionSignature = thisSignature;
    }
    if (provisionFailureStreak >= abortThreshold) {
      log.error(
        `[flume] worktree provisioning failed with an identical signature ` +
          `${provisionFailureStreak} consecutive ticks (${lastProvisionSignature}); ` +
          `aborting after ${ticks} tick(s) instead of burning the remaining ` +
          `ticks against the same wall.`,
      );
      return {
        ticks,
        hibernated: false,
        repeatedFailure: {
          signature: lastProvisionSignature!,
          count: provisionFailureStreak,
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
): string {
  const parts: string[] = [phaseName];
  if (result.committed) {
    if (result.shippedTags.length > 0) {
      parts.push(`shipped ${result.shippedTags.join(", ")}`);
    } else if (result.commitSha) {
      parts.push(`committed ${result.commitSha.slice(0, 8)}`);
    }
    // A wave can ship *and* hit the §5 backstop (some entries landed before
    // the ref moved; the rest, or the trailing ledger commit, refused).
    if (tipMoved) parts.push("(tip-moved for part of this tick)");
  } else {
    // The §6 mode in the one-liner is the logger record that lets a
    // voluntary-bail loop be told from a platform-preempt run without
    // reading session logs. `tip-moved` (RELEASE-v0.11 §5) is reported the
    // same way even though it is never a `NoCommitMode` — the one-liner is
    // a rendering, not the typed fact itself.
    parts.push(
      tipMoved
        ? "no commit (tip-moved)"
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
 * verbatim), else the last `assistant` turn's concatenated text blocks. A
 * plain-text agent (`claudeCode({ outputFormat: "text" })`) emits no
 * stream-json events — its stdout already IS the final message, returned
 * unchanged. Either way the result is `tailBound` to `MAX_PRIOR_NOCOMMIT`:
 * a bail names its constraint at the tail of its closing message.
 */
function finalAgentMessage(stdout: string): string {
  let sawStreamJson = false;
  let resultText: string | undefined;
  let lastAssistantText: string | undefined;

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // a non-JSON line is not a stream-json event
    }
    if (!evt || typeof evt !== "object") continue;
    const e = evt as Record<string, unknown>;
    if (typeof e.type !== "string") continue;
    sawStreamJson = true;
    if (e.type === "result") {
      if (typeof e.result === "string" && e.result.trim().length > 0) {
        resultText = e.result.trim();
      }
    } else if (e.type === "assistant") {
      const text = assistantTurnText(e);
      if (text.length > 0) lastAssistantText = text;
    }
  }

  if (!sawStreamJson) {
    // Plain-text agent: stdout already IS the final message.
    return tailBound(stdout.trim(), MAX_PRIOR_NOCOMMIT);
  }
  return tailBound(resultText ?? lastAssistantText ?? "", MAX_PRIOR_NOCOMMIT);
}

/**
 * Concatenated `text` blocks of one stream-json `assistant` event;
 * `tool_use`/`thinking` blocks are dropped (they are not the agent's prose).
 */
function assistantTurnText(e: Record<string, unknown>): string {
  const msg = e.message as { content?: unknown } | undefined;
  const content = Array.isArray(msg?.content) ? msg!.content : [];
  const parts: string[] = [];
  for (const c of content) {
    if (
      c &&
      typeof c === "object" &&
      (c as Record<string, unknown>).type === "text" &&
      typeof (c as Record<string, unknown>).text === "string"
    ) {
      parts.push(((c as Record<string, unknown>).text as string).trim());
    }
  }
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
 * immediately before it would have committed didn't match the tip it
 * recorded at tick start. A sibling to the §6 builders above, never a
 * `NoCommitMode` — see {@link TipMovedAttempt}.
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
