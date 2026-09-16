/**
 * The tick verdict — the facts artifact every tick that runs a phase leaves
 * behind: its shape, the stage-failure and merge-fate vocabularies it
 * carries, and the read/write/clear I/O over the two files it lives in.
 *
 * spec/loop.md "The tick verdict — one facts artifact". The dispatcher
 * builds a verdict, the CLI writes it, `superviseLoop` and a chain's
 * `shouldRun`/`handoff` read it back: three surfaces on one shape, so the
 * shape and its I/O live in their own file rather than inside whichever of
 * them happens to construct it (`.claude/rules/engineering.md`, *A module is
 * one job*).
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

import type { AgentUsage } from "./Agent.js";
import { namespacedJoin, tickVerdictPath, tickVerdictsLogPath } from "./paths.js";
import type { NoCommitMode } from "./Prompt.js";

/**
/**
 * One pre-tick worktree provisioning failure — the
 * dispatcher never reached the agent for the affected entry (or, for a
 * repo-level failure, for any entry this tick).
 *
 * The exported name is pinned by `src/index.ts`'s barrel export and by
 * `tests/Dispatcher.test.ts`'s barrel-export pin, so it stays `ProvisionFailure`
 * — provision-stage only — even though {@link MergeFailure} and
 * {@link GateFailure} below now share its exact shape for the two stages
 * spec/loop.md's "Repeated identical failures" generalized the backstop to.
 */
export type ProvisionFailure = StageFailureEntry & {
  /**
   * Comparable signature — the same deterministic wall (e.g. the same held
   * directory) yields the same signature tick over tick, letting the
   * consecutive-failure backstop recognize a repeat without diffing full
   * error text.
   */
  signature: string;
  /** Full error message, for the quarantine/abort log lines. */
  message: string;
};

/**
 * Which entry a stage failure is blamed on — **both halves or neither**, so
 * the supervisor's quarantine leg can never read a tag it has no key to
 * hold it under (`.claude/rules/engineering.md`, *Narration is the ladder's
 * bottom rung*: the pairing is a type, not a comment asking each call site
 * to remember).
 *
 * - `tag` is the entry the failure is scoped to (a `createWorktree` failure
 *   for that specific slug, a cherry-pick conflict on that entry's commit, a
 *   gate revert of it). Absent for a repo-level failure (e.g. `git worktree
 *   prune`) or a singleton phase's own revert, where no single entry can be
 *   blamed — the run-scoped quarantine only ever isolates a *blamed* failure;
 *   an unblamed one is exactly the "non-entry-scoped" class the
 *   consecutive-failure backstop exists for.
 * - `quarantineKey` is that entry's key **as this tick read it** from
 *   `pending.json` ({@link quarantineKey}), the value the supervisor holds
 *   the quarantine under and crosses to the next child on
 *   `FLUME_QUARANTINED_SLUGS`. Reported rather than recomputed: the
 *   supervisor holds only the verdict, and a second read of `pending.json`
 *   there would key the hold on bytes a *later* tick wrote
 *   (`.claude/rules/engineering.md`, *A fact the engine holds is
 *   reported*).
 */
export type StageFailureEntry =
  | { tag: string; quarantineKey: string }
  | { tag?: undefined; quarantineKey?: undefined };

/**
 * A merge-stage failure (spec/loop.md "Repeated identical failures — quarantine,
 * then abort"): a cherry-pick conflict, or a dirty trunk refusing the pick, that
 * kept a worktree's already-agent-committed work off trunk. `tag` is the
 * fanout entry's tag; absent for a singleton phase's own merge-stage failure
 * (no entry to quarantine — same rationale as {@link StageFailureEntry}, it
 * falls to the consecutive-failure backstop alone).
 */
export type MergeFailure = StageFailureEntry & {
  /** Same comparison-key contract as `ProvisionFailure.signature`. */
  signature: string;
  message: string;
};

/**
 * A gate-stage failure (spec/loop.md "Repeated identical failures — quarantine,
 * then abort"): an afterCommit or afterMerge gate that reverted a commit,
 * `signature` derived from the gate's own name plus its failure output. `tag`
 * is absent for a singleton phase's own gate revert (no entry to quarantine —
 * it falls to the consecutive-failure backstop alone) and present for a
 * fanout entry/wave gate revert.
 */
export type GateFailure = StageFailureEntry & {
  /** Same comparison-key contract as `ProvisionFailure.signature`. */
  signature: string;
  message: string;
};

/**
 * One gate's result as the engine reports it — the single row shape every
 * reporting surface carries: a {@link TickVerdict}'s `gateResults` on disk,
 * `TickResult.gateResults` for `handoff`, and `ShipContext.gateResults` for
 * `shipped` (`./Phase.js`, spec/chain.md "What a hook receives"). One shape,
 * so a hook reads the same fields a verdict reader does and never
 * pattern-matches `message` for a discriminant its own chain authored
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported*).
 * It doubles as the local accumulator the gate loops push into: the fields
 * are mutable, so nothing widens or narrows on the way out.
 */
export interface ReportedGateResult {
  gate: string;
  ok: boolean;
  message: string;
  /**
   * The gate's own `GateResult.details` (`./Gate.js`), copied verbatim — the
   * long-form evidence behind `message`: for a failing writable-paths gate
   * that is the actual list of violating paths, never a re-derived summary.
   * Absent when the gate offered none.
   */
  details?: string;
  /**
   * The gate's own `GateResult.verdict` (`./Gate.js`), copied verbatim — the
   * chain-authored discriminant for *why* the gate ruled as it did. Absent
   * when the gate authored none. Copied, never interpreted: a chain reading
   * a persisted verdict keys on this field instead of pattern-matching its
   * own prose back out of `message` (spec/chain.md "What a gate returns").
   */
  verdict?: string;
  /**
   * The gate's own `GateResult.skipped` (`./Gate.js`), copied verbatim: `ok`
   * was not earned by running a judge, and the gate said why. Absent means
   * the gate claims it ran. Copied, never interpreted — a verdict reader
   * tells a passed gate from one that never ran without pattern-matching
   * `message` (spec/chain.md "What a gate returns").
   */
  skipped?: string;
  /**
   * The gate's own `GateResult.failingFiles` (`./Gate.js`), copied verbatim:
   * the repo-relative paths the gate attributed the failure to. Absent when
   * the gate named none. The engine already decodes this to derive the
   * suspect-flake marker on a prior-attempt record, so a chain reading the
   * verdict or a `handoff` reads the same list instead of re-parsing the
   * gate's output beside it (`.claude/rules/engineering.md`, *A fact the
   * engine holds is reported, never rediscovered*).
   */
  failingFiles?: string[];
}

/**
 * How a fanout entry's landed worktree commit fared once the wave tried to
 * put it on trunk:
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
 *                            gate; never reached
 *                            cherry-pick, so it never touched trunk on its
 *                            own.
 *  - `not-shipped`           landed and passed every gate, but the phase's own
 *                            `shipped` predicate returned false
 *                            (spec/pending.md "Ship detection trusts the
 *                            agent's own account") — commit stays on trunk,
 *                            entry stays pending. The engine records the
 *                            chain's verdict and holds no vocabulary for its
 *                            reason.
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
 * One provisioned span's {@link MergeOutcome}, as recorded in a {@link
 * TickVerdict} — per entry under fanout, the phase's own single span under
 * singleton. `footprint` is the span's actual touched paths — present
 * on the outcomes that never landed cleanly on trunk (`cherry-pick-conflict`,
 * `afterMerge-reverted`, `afterCommit-reverted`) where a captured diff
 * exists; absent when the outcome carries no footprint of its own (`merged`,
 * `not-shipped`, or a best-effort capture that failed). `commitPendingUpdate`
 * sources a wave's footprint commit from this same field — the same verdict
 * record, never a separate capture, so there is no
 * independently-maintained observed-files map.
 */
export interface TickVerdictMergeOutcome {
  /**
   * The fanout entry this span belongs to. Absent on a singleton phase's own
   * span, which has no entry to tag — the verdict's `phaseName` already names
   * it, and restating it here would invent a tag naming no queue entry (same
   * shape as {@link TickVerdictInvocation.entryTag}, and the same name).
   */
  entryTag?: string;
  outcome: MergeOutcome;
  footprint?: string[];
  /**
   * The base `headSha` is reachable from, so `baseSha..headSha` is exactly
   * this span and nothing adjacent. Pairs with whichever sha `headSha` holds:
   * the pre-cherry-pick trunk tip for a span that reached trunk (`merged`,
   * `afterMerge-reverted`, `afterMerge-revert-refused`, `not-shipped`), else
   * the tip the agent's worktree branched from (`tip-moved`, `dropped-work`,
   * `afterCommit-reverted`, `cherry-pick-conflict`). Recovery needs both: a
   * span may hold several commits (spec/loop.md "N commits are completion"),
   * and `headSha` alone re-picks only the last of them. Absent only when the
   * span never reached a commit at all.
   */
  baseSha?: string;
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
  /**
   * The message a `shipped` predicate *threw* instead of returning
   * (`spec/chain.md`, *What a hook receives*: a throw is not `false`). Only a
   * `not-shipped` outcome carries it, and only when a throw produced that
   * outcome — absent when the predicate deliberately returned `false`, so a
   * chain reading the verdict tells a declined ship from a broken predicate
   * without the two collapsing into one record.
   */
  threw?: string;
}

/**
 * spec/loop.md "The tick verdict — one facts artifact", "Every agent
 * invocation leaves a usage row": one row per agent run this tick, carrying
 * whatever cost/usage facts that run's {@link AgentResult} reported.
 * `entryTag` names the provisioned entry under fanout — the same name and
 * rule as {@link AgentInvocation.entryTag}; absent for a singleton phase,
 * which has no entry to tag.
 */
export interface TickVerdictInvocation extends AgentUsage {
  entryTag?: string;
  /**
   * spec/prompt.md "The rendered prompt is persisted before the agent runs":
   * the file holding the prompt this invocation was handed, byte for byte,
   * as a forward-slash path relative to `flumeDir`. Written before
   * `agent.invoke`, so a row exists iff the file does — the read-side record
   * beside the write fence, and the one place "what was this tick told"
   * is answerable without re-rendering.
   */
  promptPath: string;
  /**
   * spec/loop.md "Tip verify": the tracked paths this run left dirty in its
   * worktree — modified and not committed — read while the worktree still
   * existed, immediately before teardown removes it and them. Covers the
   * agent's own leftovers and the content a soft-reset span (a tip-verify
   * refusal, an `afterCommit` gate revert) put back into the tree, whichever
   * the tick produced.
   *
   * Always present on a row, `[]` when the tick left nothing behind: "the
   * loss is seen even though it is not preserved" is only readable if the
   * no-loss case is stated too, and an absent key would make a clean
   * teardown indistinguishable from a read that never happened. Untracked
   * files are out of scope ({@link git.trackedModifications}).
   *
   * A fact, never a verdict: the engine says what went away with the
   * worktree; whether that matters is the chain's
   * (`.claude/rules/engine-boundary.md`).
   */
  uncommittedTracked: string[];
}

/**
 * The one facts artifact every tick that actually runs a phase writes —
 * phase, entry tag(s), committed/no-commit class, gate results, shipped
 * tags, and (fanout) each provisioned entry's cherry-pick/merge fate. The
 * only such channel: no counts file, no footprint-only capture, and no
 * in-process-only `TickResult.noCommit` beside it.
 *
 * No interpretation fields: this is what happened, never what it means —
 * "park", "bail worth waking for" are a chain's own readings, not engine
 * vocabulary. `errored` (the run-level failure classification) is
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
   * No-commit classification, present iff the tick (or, for
   * a fanout wave, the whole wave) produced no usable commit. Absent on a
   * committed tick or a nothing-pickable no-op (no agent ran).
   */
  noCommit?: NoCommitMode;
  /**
   * Set when this tick (or, for a fanout wave, any part of
   * it) hit the tip-verify backstop and refused a commit. Two producers,
   * and neither compares the ref against a tip recorded at tick start:
   *
   *  - before every harness-driven commit — each cherry-pick and the
   *    trailing pending-ledger commit — a **live foreign claim** on the ref,
   *    which is a second engine instance interleaving merges. An unclaimed
   *    foreign commit is absorbed instead: the pick lands onto whatever tip
   *    is current and git's conflict detection arbitrates content.
   *  - on the agent's own private `flume/**` branch, a **recorded base that
   *    is no longer an ancestor** of the HEAD the agent left — something
   *    reset or rewrote the branch out from under it. Committing twice on
   *    that branch is a completed tick, not interference, so the check is
   *    ancestry rather than equality.
   *
   * A sibling fact to `noCommit`, never folded into it: the cause here is
   * never one of the four `NoCommitMode` classes, and a wave can carry both
   * (some entries shipped before the refusal, the rest refused) or
   * `tipMoved` alone with `committed: true` (every entry that reached
   * cherry-pick shipped; only the trailing pending-ledger commit refused).
   * Absent when nothing this tick touched hit the backstop.
   */
  tipMoved?: boolean;
  /**
   * Set when this tick (or, for a fanout wave, any part
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
  /**
   * spec/loop.md "Crash equals stop": the sha of a dangling commit
   * (`git stash create`'s shape — object written, no ref moved, nothing
   * reset) capturing whatever was staged or unstaged on the primary
   * checkout when this tick's merge stage began, checkpointed before the
   * tick's first cherry-pick range so a later `--abort` or gate revert can
   * never destroy the operator's own bystander work unrecoverably. Absent
   * when the tree was clean at that point, or when the tick's merge stage
   * never began (nothing committed to cherry-pick).
   */
  bystanderCheckpointSha?: string;
  /** Every gate that ran this tick, in run order, across every entry. */
  gateResults: ReportedGateResult[];
  /** Entry tags shipped by this tick (entries the phase's `shipped` predicate rejected already excluded); empty for a singleton phase. */
  shippedTags: string[];
  /** Fanout only; empty for a singleton phase or a wave with nothing provisioned. */
  mergeOutcomes: TickVerdictMergeOutcome[];
  /**
   * spec/loop.md "The tick verdict", "Every agent invocation leaves a usage
   * row": one entry per agent run this tick — one for a singleton, one per
   * provisioned entry that actually reached `invokeAgent` under fanout.
   * Empty when nothing this tick invoked the agent at all (declined,
   * render-refused, or nothing pickable).
   */
  invocations: TickVerdictInvocation[];
  /**
   * Pre-tick worktree provisioning failures (sweep or
   * create) this tick recorded, before any agent ran for the affected
   * entries. Absent/empty when the tick hit none.
   */
  provisionFailures?: ProvisionFailure[];
  /**
   * Merge-stage cherry-pick-conflict failures this tick recorded
   * (spec/loop.md "Repeated identical failures").
   * Absent/empty when the tick hit none.
   */
  mergeFailures?: MergeFailure[];
  /**
   * Gate-stage failures — an afterCommit
   * or afterMerge gate revert — this tick recorded. Absent/empty when the
   * tick hit none.
   */
  gateFailures?: GateFailure[];
  /**
   * spec/loop.md "No false signal": prior-attempt records this tick cleared
   * as stale — entry-keyed records whose tag the queue the wave read no
   * longer carries — by the key each was filed under. The retry those
   * records were written for will never happen, so the wave that observes
   * the tag's absence is what retires them, and says which. Absent/empty
   * when the wave found none, and on a singleton tick, which selects no
   * entries from the queue.
   */
  clearedPriorAttempts?: string[];
  /** This tick's one-line logger summary, verbatim — a rendering of the facts above, not a judgment of them. */
  summary: string;
  /**
   * spec/loop.md "The tick verdict — one facts artifact": the trunk repo's
   * HEAD at the moment this verdict was built — after this tick's own
   * commits, if any, already landed. "Has the world moved since this phase
   * last ran" is therefore a comparison against this field, never an
   * inference from which paths the last commit touched, and a quiet
   * (no-commit) tick still leaves an anchor behind: a phase need not commit
   * just to record one.
   */
  headSha: string;
  /** ISO timestamp alongside {@link headSha} — ambient wall-clock context, not itself load-bearing. */
  at: string;
}

/**
 * Two files under the state dir, both stable paths, neither a
 * dogfood convention. Their names live in `STATE_ROOT_NAMES`
 * (`src/paths.ts`) with the rest of the state root's layout, so the job
 * `.gitignore` seed carries them without a second spelling; the accessors
 * are re-exported here, where what each file carries is defined:
 *  - {@link tickVerdictPath} — this tick's verdict alone, overwritten
 *    every real `flume tick` process (the CLI's `tick` command writes it,
 *    from the `TickVerdict` its own `dispatcher.tick()` call returned —
 *    never `Dispatcher.tick()` itself, which plain unit tests call directly
 *    and must not gain an untracked side effect underfoot). `clearTickVerdict`
 *    removes it before that same tick's own work begins, so a tick that
 *    never reaches the write (chain-load failure, hibernation, terminal
 *    misconfiguration) leaves nothing for `superviseLoop` to misread as its
 *    own.
 *  - {@link tickVerdictsLogPath} — every verdict ever written, appended
 *    and bounded to {@link MAX_TICK_VERDICTS}, read back by the exported
 *    `readTickVerdicts` accessor so a chain can render recent tick history
 *    into a prompt. Never cleared — it is history, not a per-tick signal.
 */
export { tickVerdictPath, tickVerdictsLogPath };

/** Bound on {@link tickVerdictsLogPath}'s file — a rolling window, not an unbounded log. */
const MAX_TICK_VERDICTS = 200;

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
    Array.isArray(r.invocations) &&
    typeof r.summary === "string" &&
    typeof r.headSha === "string" &&
    typeof r.at === "string"
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
 * (`src/loopSupervisor.ts`), this export's only consumer, between child
 * ticks. Corrupt or absent (the CLI clears it before every
 * tick and writes it only once that tick's `dispatcher.tick()` call has
 * returned) degrades to "nothing to report" — a missing record must never
 * be misread as a prior tick's stale one.
 */
export async function readTickVerdict(
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
 * recent tick history into a prompt. Corrupt lines are skipped,
 * never thrown; an absent log reads as empty history — same no-false-signal
 * posture as every other artifact the harness persists.
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

/**
 * The most recent {@link TickVerdict} per `phaseName`, read synchronously
 * from the same history log {@link readTickVerdicts} serves. `Phase.shouldRun`
 * and `Phase.handoff` (`spec/loop.md` "Declining a tick before the
 * invocation") are synchronous by contract, so a chain reading `headSha`/`at`
 * from either needs this rather than the async accessor behind an `await`
 * it cannot take. Corrupt lines are skipped, same no-false-signal posture as
 * `readTickVerdicts`; an absent log reads as an empty result, never a throw.
 */
export function readLatestVerdictsSync(
  flumeDir: string,
): Record<string, TickVerdict> {
  const p = namespacedJoin(tickVerdictsLogPath(flumeDir));
  const latest: Record<string, TickVerdict> = {};
  if (!existsSync(p)) return latest;
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    return latest;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec: unknown = JSON.parse(trimmed);
      // Log order is chronological (append-only), so the last record parsed
      // for a given phaseName is the most recent — no timestamp comparison
      // needed.
      if (isTickVerdict(rec)) latest[rec.phaseName] = rec;
    } catch {
      // a corrupt line is skipped, not fatal to the rest of the history
    }
  }
  return latest;
}
