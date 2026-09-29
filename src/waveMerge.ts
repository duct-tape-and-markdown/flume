/**
 * The merge stage of a wave: everything a `fanout` phase does to trunk with a
 * per-entry attempt once that entry's agent has finished. It takes one
 * attempt at a time and carries its span across — the merge marker it stakes,
 * the cherry-pick, the `afterMerge` gates it runs on the merged tip, the
 * per-entry revert when one turns red, the `shipped` consult, and the
 * pending-ledger rewrite (`src/pendingLedger.ts`) that retires that one entry
 * and records what it touched — answering the merge outcomes, gate rows and
 * failure records the wave's verdict is folded from.
 *
 * Three calls, not one, because a span is carried **as its own agent
 * finishes** rather than after the batch settles (`spec/worktrees.md`,
 * *Fanout and worktrees — provisioning, isolation, teardown*): a wave never
 * waits on its slowest agent to merge its fastest. {@link openWaveMerge}
 * opens the stage, {@link mergeAttempt} carries one finished attempt, and
 * {@link closeWaveMerge} folds what they observed. Only the middle one
 * touches trunk, and the ledger commit rides inside its hold: a wave can
 * outlast many merges, and a queue that went on listing an entry already on
 * the trunk would be read as current by every producer beside it. One
 * ship-lock span per pick — taken when the pick begins and released however
 * it leaves, shipped, reverted or thrown as a {@link WaveLedgerRefusal} — so
 * a sibling tick gets its turn between two of this wave's picks and reads a
 * queue that matches the trunk it is looking at. What one span learned and
 * the next needs is {@link WaveMerge}.
 *
 * Its caller is the wave leg (`src/waveTick.ts`), which selects the batch,
 * provisions the worktrees, runs the fanout, serializes these calls behind
 * each finishing agent, and tears the worktrees down after them.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";

import { bound } from "./bounds.js";
import { runGate } from "./gateRun.js";
import * as git from "./git.js";
import type { MergingMarker } from "./mergingMarkers.js";
import {
  mergingDir,
  mergingMarkerPath,
  namespacedJoin,
  slugify,
} from "./paths.js";
import {
  commitPendingUpdate,
  type PendingRewriteNoCommitExit,
  type PendingRewriteResult,
} from "./pendingLedger.js";
import { PendingParseFailure, type PendingEntry } from "./PendingSchema.js";
import type { Phase } from "./Phase.js";
import type { NoCommitMode } from "./Prompt.js";
import {
  buildGateRevert,
  buildNotShipped,
  priorAttemptRef,
} from "./priorAttempts.js";
import { blamedOn } from "./selection.js";
import type { AttemptOutcome } from "./tickAttempt.js";
import type { TickLegContext } from "./tickLeg.js";
import { checkMergedTipUnmoved, liveForeignClaimPid } from "./tipVerify.js";
import {
  buildTickVerdict,
  appendInvocationRow,
  gateFailureSignature,
  MAX_FAILURE_SIGNATURE,
  readInvocationRows,
  reportedGateRow,
  startTiming,
  throwFacts,
  unrevertableMergeFailure,
  type GateFailure,
  type MergeFailure,
  type PlatformFailure,
  type ProvisionFailure,
  type RenderFailure,
  type ShipFailure,
  type ReportedGateResult,
  type StakeLoss,
  type TickVerdict,
  type TickVerdictMergeOutcome,
  type TickVerdictTiming,
} from "./tickVerdict.js";

/**
 * Rank of each no-commit mode in a wave's representative-cause fold — lowest
 * rank wins. `gate-revert` means work was produced and lost (highest signal);
 * `render-refused` is a real defect in the prompt/config, ranked above the
 * non-defect classes; `platform-preempt` outranks `clean-exit` so a
 * rate-limited wave is not misread as the agents exiting on their own — the
 * "platform failures masquerade as agent failures" harm.
 *
 * Keyed by {@link NoCommitMode} rather than re-spelling the taxonomy, so a
 * mode added to `NO_COMMIT_MODES` (`src/Prompt.ts`) is a type error here
 * rather than a cause that silently folds to nothing.
 */
const WAVE_NO_COMMIT_RANK: Record<NoCommitMode, number> = {
  "gate-revert": 0,
  "render-refused": 1,
  "platform-preempt": 2,
  "clean-exit": 3,
};

/**
 * One provisioned fanout entry's fate, as {@link mergeAttempt} reads it: the
 * attempt's own outcome plus the entry and worktree facts the merge stage
 * acts on. `declined` is the one fate that never reaches an attempt —
 * `shouldRun` turned this entry away before the render.
 */
export type EntryAttempt = AttemptOutcome & {
  entry: PendingEntry;
  /** This entry's worktree, still on disk when the merge stage classifies it — `ShipContext.worktreePath`. */
  worktreePath: string;
  /**
   * This entry's private worktree branch — the ref its span sits on until
   * the merge stage picks it. Carried out of the per-entry leg because the
   * merge marker (spec/loop.md "Crash equals stop") names the branch an
   * interrupted pick left standing, and the attempts are filtered out of
   * index-alignment with `worktrees` before the merge stage reads them.
   */
  branch: string;
  /** `phase.shouldRun` declined this entry before the agent was invoked. */
  declined?: boolean;
};

/**
 * Thrown in place of whatever tore this wave down, once every slot it opened
 * has finished — a ledger read or write that refused, and equally an agent
 * that exploded, a hook that threw, a render that did not resolve. Every one
 * of them leaves the same thing behind: the picks before it have landed on
 * trunk through their cherry-picks and afterMerge gates, and every agent that
 * ran has left a usage row. A bare re-throw discards all of it, so the throw
 * carries the wave's verdict as it *settled* (`spec/loop.md`, "The tick
 * verdict — one facts artifact") and `tick()` reports it instead of
 * propagating.
 *
 * The cause stays on the error for its message and for anything reading past
 * the carry. What this class deliberately does *not* hold is a ledger
 * classification: a slot leg that threw outside any ledger read refused no
 * ledger, and naming one for it would be a verdict invented at the carry
 * ({@link WaveLedgerRefusal} is the subclass for the causes that really are
 * one).
 *
 * The class is exported no further than `tick()`'s own catch: unlike
 * `PendingParseFailure` itself (part of the gate-authoring API surface,
 * `src/flumeApi.ts`) this is the wave's one internal leg, absent from
 * `src/index.ts` and never something a chain's gate needs to distinguish.
 */
export class WaveCarriedThrow extends Error {
  readonly verdict: TickVerdict;
  constructor(cause: unknown, verdict: TickVerdict) {
    super(refusalMessage(cause), { cause });
    this.name = "WaveCarriedThrow";
    this.verdict = verdict;
  }
}

/**
 * The carry for the causes that *are* a pending-ledger refusal —
 * `commitPendingUpdate`'s rewrite behind a pick ({@link waveMergeError}), or
 * the decide re-read a freed slot takes over a queue this phase's fence
 * cannot rewrite ({@link waveSlotThrow}, `refillRead` in `src/waveTick.ts`).
 * The rewrite read that would not parse is one of them; so is the
 * `git commit --only` that fatals on a partial commit under a paused merge
 * or cherry-pick, a named path git finds unchanged, a disk error, a lost
 * `index.lock`. The rewrite's carry is widened to the call rather than keyed
 * on a cause, because every cause leaves the same tags on trunk.
 *
 * `refusalClass` is the one thing it adds to its base: stated here from the
 * `cause` in hand rather than re-read downstream off the refusal's own prose
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). A plain
 * `PendingParseFailure` reaches `tick()` unwrapped only from the *opening*
 * decide-read, where no agent ran and nothing shipped — a wave's own mid-wave
 * re-read has spans behind it and leaves wrapped.
 *
 * {@link LedgerRefusalClass} does ship — it is what the tick outcome reports.
 */
export class WaveLedgerRefusal extends WaveCarriedThrow {
  readonly refusalClass: LedgerRefusalClass;
  constructor(cause: unknown, verdict: TickVerdict) {
    super(cause, verdict);
    this.name = "WaveLedgerRefusal";
    this.refusalClass =
      cause instanceof PendingParseFailure ? "parse-failure" : "commit-refusal";
  }
}

/**
 * Which way a pending-ledger read or write refused. Two causes with two
 * repairs, and so two exit codes (`spec/loop.md`, *Exit codes — the run never
 * lies to CI*):
 *
 * - `"parse-failure"` — the queue on disk would not parse. A fresh process
 *   reads the same bytes until the queue's declared writer runs over them, so
 *   the tick is mount-dead (69) and `flume loop` fail-fasts rather than
 *   burning its remaining ticks on the same wall.
 * - `"commit-refusal"` — the queue parsed and the rewrite's own commit
 *   refused: a `git commit --only` fatal under a paused merge or cherry-pick,
 *   a named path git finds unchanged, a disk error, a lost `index.lock`.
 *   Nothing about the chain is dead, so the tick is an ordinary harness error
 *   (1) and the next tick is a fresh process with every reason to get
 *   further.
 */
export type LedgerRefusalClass = "parse-failure" | "commit-refusal";

/**
 * The refusal's own words, for a {@link WaveLedgerRefusal}'s message and for
 * the verdict summary built beside it — one spelling, so the two cannot
 * describe one refusal differently.
 */
function refusalMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Wave-level no-commit cause, only meaningful when the wave shipped
 * nothing usable — shared by the wave's normal-completion verdict and by
 * `WaveLedgerRefusal`'s partial verdict (.claude/rules/engineering.md
 * "Derived state is computed, never restated beside its source"), so a
 * ledger refusal reports the same cause a clean completion would have. The
 * precedence is {@link WAVE_NO_COMMIT_RANK}.
 */
function waveNoCommitCause(
  committedWave: boolean,
  attempts: readonly { noCommit?: NoCommitMode }[],
  mergeReverted: readonly unknown[],
): NoCommitMode | undefined {
  if (committedWave) return undefined;
  const modes = attempts.flatMap((r) => (r.noCommit ? [r.noCommit] : []));
  // Per-entry afterMerge isolation wrote a gate-revert prior-attempt
  // record for each merge-reverted entry; reflect that in the wave-level cause.
  if (mergeReverted.length > 0) modes.push("gate-revert");
  return modes.reduce<NoCommitMode | undefined>(
    (best, mode) =>
      best === undefined ||
      WAVE_NO_COMMIT_RANK[mode] < WAVE_NO_COMMIT_RANK[best]
        ? mode
        : best,
    undefined,
  );
}

/**
 * What the wave's fanout declares when it opens its merge stage. Beyond the
 * leg and phase every pick runs against, the wave facts a
 * {@link WaveLedgerRefusal}'s partial verdict has to name — the batch that
 * was provisioned, the provisioning walls already recorded, the entries a
 * sibling took before the stake reached them, and the records the wave's
 * opening queue read retired — since that verdict is assembled inside the
 * stage and never reaches the leg's own return.
 *
 * The attempts are not here. A wave hands them over one at a time, each as
 * its own agent finishes ({@link mergeAttempt}), so the set is not known
 * when the stage opens.
 */
interface WaveMergeSetup {
  readonly leg: TickLegContext;
  readonly phase: Phase;
  /** Every entry this wave provisioned a worktree for, reached or not. */
  readonly provisioned: readonly PendingEntry[];
  /** The chain's footprint-ignore list, as the ledger rewrite consumes it. */
  readonly partitionIgnore: string[];
  /** Provisioning walls the wave recorded before the fanout. */
  readonly provisionFailures: ProvisionFailure[];
  /**
   * Render refusals the wave recorded, one per entry whose prompt never
   * resolved. The leg's own array, filled as each attempt returns — the
   * refusal is not this stage's fact, and this stage reads it for the same
   * reason it reads `provisionFailures`: the refusal verdict below has to name
   * every stage-failure class the completing verdict would.
   */
  readonly renderFailures: RenderFailure[];
  /**
   * Platform preempts the wave recorded, one per agent that failed for
   * non-work reasons. The leg's own array on the same terms as
   * `renderFailures` above, and unblamed by its own type
   * (`PlatformFailure`, `./tickVerdict.js`).
   */
  readonly platformFailures: PlatformFailure[];
  /**
   * Entries the wave selected and then lost the stake race for, each naming
   * the holder that took it.
   */
  readonly stakeLosses: StakeLoss[];
  /** Prior-attempt records the wave's opening queue read retired. */
  readonly clearedPriorAttempts: string[];
}

/**
 * A wave's merge stage while it is running: opened by {@link openWaveMerge},
 * advanced once per finished attempt by {@link mergeAttempt}, closed by
 * {@link closeWaveMerge}.
 *
 * It is a value rather than a set of locals because the stage is no longer
 * one call. A span is carried onto trunk as its own agent finishes
 * (`spec/worktrees.md`, *Fanout and worktrees — provisioning, isolation,
 * teardown*), so what one pick learned — the bystander checkpoint it took,
 * the outcomes and gate rows it recorded — has to outlive that pick and reach
 * the fold the wave ends with. Every field below is an accumulator, and
 * nothing reads across entries except the checkpoint, the one thing the wave
 * is still explicitly once-per-wave about.
 */
interface WaveMerge {
  readonly setup: WaveMergeSetup;
  /**
   * Every attempt this stage was handed, in the order their agents
   * finished — the set {@link waveNoCommitCause} folds and whose per-entry
   * gate rows {@link closeWaveMerge} folds.
   */
  readonly attempts: EntryAttempt[];
  /** Entries whose span landed on trunk and whose `shipped` consult said so. */
  readonly shipped: PendingEntry[];
  /** Entries whose `afterMerge` gate failed and whose commit was reverted off trunk. */
  readonly mergeReverted: PendingEntry[];
  /**
   * Entries whose afterMerge gate failed AND whose revert-off-trunk was
   * itself refused by a bystander collision — never added to
   * {@link WaveMerge.mergeReverted}, since that array's tags feed
   * `revertedTags` and claiming a revert that never happened would misreport
   * the tree. Counted alongside it only for {@link waveNoCommitCause}'s
   * gate-revert classification, which cares that a gate failed, not whether
   * the follow-up reset landed.
   */
  readonly revertRefused: PendingEntry[];
  /** This stage's own afterMerge gate rows, wave-cumulative across entries. */
  readonly mergeGateResults: ReportedGateResult[];
  /** Each merged attempt's own gate rows, in the order they were merged. */
  readonly attemptGateResults: ReportedGateResult[];
  /**
   * spec/loop.md "The tick verdict — one facts artifact": every
   * {@link TickVerdictTiming} row this wave produced, in the order the engine
   * ran them — each attempt's afterCommit rows as its span arrives, then that
   * entry's own afterMerge rows and the merge row itself. One array rather
   * than the two the gate rows take, because nothing slices it: that split
   * exists so `ShipContext.gateResults` can name one entry's afterMerge rows
   * alone, and no hook is handed timings.
   */
  readonly timings: TickVerdictTiming[];
  /**
   * Each provisioned entry's cherry-pick/merge fate, for this wave's
   * TickVerdict — the sole capture of what happened to each entry, footprint
   * included. `commitPendingUpdate` (`src/pendingLedger.ts`) reads a wave's
   * merge-failure footprints straight off these records (the same ones
   * `tick()` persists as `verdict.mergeOutcomes`) rather than a second,
   * independently-maintained observed-files map. An afterCommit gate-revert
   * or a plain no-commit entry never reaches cherry-pick, so it gets an
   * outcome here only when it carried a captured footprint.
   */
  readonly mergeOutcomes: TickVerdictMergeOutcome[];
  /**
   * Merge-stage failures this wave recorded — sibling accounting to the
   * setup's `provisionFailures`, fed to the same wave-level verdict for
   * superviseLoop's quarantine + consecutive-identical backstop to key off.
   */
  readonly mergeFailures: MergeFailure[];
  /** Gate-stage failures, the sibling accounting to {@link WaveMerge.mergeFailures}. */
  readonly gateFailures: GateFailure[];
  /**
   * Ship-stage failures — one per span whose `shipped` consult threw
   * ({@link ShipFailure}), on the same terms as the two above. This stage is
   * the only place the consult happens, so it is the only place this record
   * is produced.
   */
  readonly shipFailures: ShipFailure[];
  /**
   * Every ledger commit this wave has landed, in the order it landed them —
   * one per pick whose rewrite reported one, empty while every rewrite so far
   * wrote no commit (a footprint already recorded, a live foreign tip claim
   * refusing before the writes, an out-of-tree dock git cannot see). One per
   * pick rather than one per wave,
   * so the set is what the wave landed and its last element is the tip
   * contribution a handoff reads as `TickResult.commitSha`; both reach a
   * chain, the set as `TickResult.ledgerCommitShas`.
   */
  ledgerShas: string[];
  /** A tip claim or a per-entry ancestry refusal stopped at least one span. */
  tipMoved: boolean;
  /** `shouldRun` declined at least one entry. */
  declined: boolean;
  /**
   * spec/loop.md "Crash equals stop": checkpointed once, lazily, right
   * before this wave's first cherry-pick range. Tracked as its own flag
   * (rather than testing the sha itself) so a clean tree at that moment —
   * `checkpointBystanderState` returning `undefined` — is never retried on a
   * later entry in the same wave.
   */
  checkpointAttempted: boolean;
  /** The checkpoint staked over the operator's uncommitted work, when one was taken. */
  bystanderCheckpointSha: string | undefined;
  /**
   * The cause a pick's ledger rewrite refused with, boxed so that "refused"
   * is readable whatever the cause is; `undefined` while none has.
   *
   * Held on the stage rather than carried out by the throw alone because the
   * verdict naming this refusal is built where the wave has *settled* — every
   * slot finished ({@link waveMergeError}) — and a re-thrown cause is
   * indistinguishable there from any other merge throw
   * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
   */
  refusal: { readonly cause: unknown } | undefined;
}

/**
 * What the merge stage observed, once every span it was handed has been
 * carried and the queue rewritten. Facts, never a fold: the wave leg maps
 * these onto its `TickResult` and its verdict, and a chain reads them there
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 */
interface WaveMergeResult {
  /** Entries whose span landed on trunk and whose `shipped` consult said so. */
  readonly shipped: PendingEntry[];
  /** Entries whose `afterMerge` gate failed and whose commit was reverted off trunk. */
  readonly mergeReverted: PendingEntry[];
  /** Every gate row this wave produced — the per-entry rows plus this stage's own. */
  readonly allGateResults: ReportedGateResult[];
  /** See {@link WaveMerge.timings}. */
  readonly timings: TickVerdictTiming[];
  /** Whether anything shipped. */
  readonly committedWave: boolean;
  /** See {@link WaveMerge.ledgerShas}. */
  readonly ledgerShas: readonly string[];
  readonly mergeOutcomes: TickVerdictMergeOutcome[];
  readonly mergeFailures: MergeFailure[];
  readonly gateFailures: GateFailure[];
  readonly shipFailures: ShipFailure[];
  /** A tip claim or a per-entry ancestry refusal stopped at least one span. */
  readonly tipMoved: boolean;
  /** `shouldRun` declined at least one entry. */
  readonly declined: boolean;
  /** The checkpoint staked over the operator's uncommitted work, when one was taken. */
  readonly bystanderCheckpointSha?: string;
  /** Wave-level no-commit cause, only when the wave shipped nothing usable. */
  readonly noCommit?: NoCommitMode;
}

/** Open a wave's merge stage. Nothing touches git until the first attempt arrives. */
export function openWaveMerge(setup: WaveMergeSetup): WaveMerge {
  return {
    setup,
    attempts: [],
    shipped: [],
    mergeReverted: [],
    revertRefused: [],
    mergeGateResults: [],
    attemptGateResults: [],
    timings: [],
    mergeOutcomes: [],
    mergeFailures: [],
    gateFailures: [],
    shipFailures: [],
    ledgerShas: [],
    tipMoved: false,
    declined: false,
    checkpointAttempted: false,
    bystanderCheckpointSha: undefined,
    refusal: undefined,
  };
}

/**
 * Carry one finished attempt's span onto trunk, under the ship lock
 * (spec/loop.md "The ship lock and the worktree lock — sibling ticks take
 * turns at git"): the merge marker it stakes, the cherry-pick, the
 * `afterMerge` gates on the merged tip, the per-entry revert when one turns
 * red, the `shipped` consult, and the ledger commit retiring what it landed.
 *
 * Called as each agent finishes rather than once the batch has settled
 * (`spec/worktrees.md`, *Fanout and worktrees — provisioning, isolation,
 * teardown*), so a two-minute entry reaches trunk without waiting on a
 * fifteen-minute sibling. The lock is the span: it is taken here and
 * released before this returns, so a sibling tick — or the next finished
 * attempt of this same wave — picks onto the trunk as it then stands. The
 * caller serializes the calls; the lock is a pid claim, so two of them
 * in-flight in one process would wait on each other forever.
 *
 * The offending entry of a red `afterMerge` gate is the one whose
 * cherry-pick turned it red — nothing else changed since its pre-cherry-pick
 * trunk — so revert *only* its commit (reset to that point) and leave it
 * pending. Siblings already on trunk stay shipped; siblings merged after are
 * evaluated against the trunk without the reverted commit. No `reset --hard`
 * back to the tip the wave was provisioned from, so no whole-wave blast
 * radius: one flaky merge-time gate does not kill N−1 clean commits.
 */
export async function mergeAttempt(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<void> {
  const { leg } = w.setup;
  // Where this attempt's own records begin. The stage's arrays are
  // wave-cumulative and the rewrite below is per-entry, so the slice is what
  // separates what *this* pick landed from what a sibling landed before it.
  // Taken ahead of the fold, which contributes this pick's own first record
  // when its attempt was reverted in its worktree with a footprint to land.
  const shippedStart = w.shipped.length;
  const outcomesStart = w.mergeOutcomes.length;
  // Everything this attempt observed away from trunk, through the one fold a
  // walled wave's uncarried attempt also takes ({@link foldAttemptFacts}), so
  // an attempt's facts have one spelling whether or not its span is carried.
  await foldAttemptFacts(w, r);

  // spec/loop.md "The ship lock and the worktree lock — sibling ticks take
  // turns at git": one merge span at a time across this run's sibling ticks.
  // The cherry-pick, the `afterMerge` judges that read the merged tip, the
  // revert that may follow and the ledger rewrite that retires the tag all
  // touch trunk — so this entry's whole passage is the span, not each git
  // call inside it. A sibling holding it is waited on, never refused: it is
  // this run's own writer, and tip verify absorbs the tip it moved.
  //
  // spec/loop.md "The tick verdict — one facts artifact": the merge row's
  // milliseconds are the pick passage — the lock a sibling may still hold,
  // the cherry-pick, the gates, the revert or the ship consult — so what the
  // wave spent off the agent's clock is one number per entry, with the gate
  // rows beside it as its breakdown. Stamped in its own `finally`, because
  // every way out of that passage is a merge that happened, and stamped
  // *before* the ledger rewrite below so a refusal there carries the same
  // rows a completing wave's verdict would.
  const mergeElapsed = startTiming();
  const shipLock = await git.acquireShipLock(leg.repoRoot, leg.log);
  try {
    let staked: string | undefined;
    try {
      staked = await carrySpan(w, r);
    } finally {
      w.timings.push({
        kind: "merge",
        entryTag: r.entry.tag,
        ms: mergeElapsed(),
      });
    }
    // The ledger commit lands inside the same hold as the pick that earned
    // it, never at the wave's end (`spec/worktrees.md`, *Fanout and worktrees
    // — provisioning, isolation, teardown*): the lock is released below, and
    // a queue still listing this entry in that gap would be read as current
    // by the sibling agents, concurrent ticks and operators looking at the
    // trunk it is already on.
    await commitAttemptLedger(
      w,
      w.shipped.slice(shippedStart),
      w.mergeOutcomes.slice(outcomesStart),
    );
    // spec/loop.md "Crash equals stop": the queue on disk now accounts for
    // this span, so the marker staked for it has nothing left to warn the next
    // start about — retired here, with the rewrite that closed its hazard,
    // rather than held for a wave that may still be running hours of agents.
    // A refusal above throws past this line, leaving the marker standing
    // exactly as a crash would.
    if (staked !== undefined) await retireMergingMarker(leg, staked);
  } finally {
    // Every way out of the span: shipped, reverted, refused, or thrown. A
    // leaked lock names a pid that is still alive, so a sibling — and this
    // wave's own next finished attempt — would wait on it for the rest of
    // the run.
    shipLock.release();
  }
}

/**
 * Everything one finished attempt observed away from trunk, folded onto the
 * stage: the rows its own afterCommit stage produced, the usage row its agent
 * left, the ancestry refusal that dropped its span, a decline, and the
 * footprint and gate failure an in-worktree revert captured. Nothing here
 * reaches trunk, so it is the whole of what an attempt whose span will never
 * be carried still has to say.
 *
 * Two callers, one spelling (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*): {@link mergeAttempt}, ahead of the ship lock its pick
 * needs, and {@link foldUncarriedAttempt} for an attempt a walled wave will
 * not carry — a decline folded or a render refusal raised behind a refusing
 * pick is a fact of this tick, and the verdict built where the wave settles
 * names it ({@link waveMergeError}).
 */
async function foldAttemptFacts(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<void> {
  w.attempts.push(r);
  w.attemptGateResults.push(...r.gateResults);
  // This entry's afterCommit rows, in front of the merge rows a carried span
  // adds after them: the wave's timings are one run order across stages, so an
  // entry's attempt time lands before the merge time it preceded.
  w.timings.push(...r.timings);
  if (r.termination) {
    // spec/loop.md "Every agent invocation leaves a usage row": on disk the
    // moment this entry's agent returned, ahead of the ship lock its pick
    // waits on. A wave of four agents is hours long and every one of them is
    // paid for as it finishes, so the rows cannot wait on the wave that
    // outlives them (`appendInvocationRow`, `src/tickVerdict.ts`).
    //
    // spec/loop.md "Tip verify — one writer per branch, absorption
    // at the merge": this entry's worktree is done being written —
    // its agent, its tip-verify soft reset and its afterCommit
    // revert all ran inside `runAttempt`, and the pick touches
    // trunk alone — but teardown is still a whole wave away, so the
    // set is readable here.
    await appendInvocationRow(w.setup.leg.flumeDir, w.setup.phase.name, {
      entryTag: r.entry.tag,
      promptPath: r.termination.promptPath,
      ...(r.termination.usage ?? {}),
      uncommittedTracked: await git.trackedModifications(r.worktreePath),
    });
  }
  if (r.tipMoved) {
    w.tipMoved = true;
    // Per-entry tip-verify leg: this entry's own ancestry check
    // refused before ever reaching cherry-pick — a real, dropped-work
    // fact, not silence a partial ship summary would otherwise paper
    // over (spec/loop.md "Tip verify — one writer per branch, absorption
    // at the merge"). Distinct from the wave-level `tip-moved` outcome
    // `carrySpan` pushes, which is the shared trunk racing during this
    // wave's own merge step.
    w.mergeOutcomes.push({
      entryTag: r.entry.tag,
      outcome: "dropped-work",
      ...(r.spanBase ? { baseSha: r.spanBase } : {}),
      ...(r.headSha ? { headSha: r.headSha } : {}),
    });
  }
  if (r.declined) w.declined = true;
  if (!r.committed) {
    // An in-worktree afterCommit gate revert never reaches
    // cherry-pick, so it never touches trunk on its own — record its
    // captured footprint here so the ledger rewrite lands it on
    // trunk instead of it living only in the gitignored prior-attempt
    // record.
    if (r.footprint && r.footprint.length > 0) {
      w.mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "afterCommit-reverted",
        footprint: r.footprint,
        ...(r.spanBase ? { baseSha: r.spanBase } : {}),
        ...(r.headSha ? { headSha: r.headSha } : {}),
      });
    }
    if (r.gateFailure) w.gateFailures.push(r.gateFailure);
  }
}

/**
 * The fold for an attempt a walled wave will never carry, and the one fact
 * only that leg can state: this span passed its afterCommit gates on its own
 * worktree branch and no pick was ever attempted over it. The base/head pair
 * is what makes it recoverable — the refusal leaves the branch standing, the
 * next start's teardown does not, and the verdict is where the sha outlives
 * the branch (spec/loop.md "The tick verdict — one facts artifact").
 *
 * Its own function rather than a flag on {@link foldAttemptFacts}, because
 * {@link mergeAttempt} takes a per-pick slice of `mergeOutcomes` across that
 * fold and hands it to the ledger rewrite: a `wave-walled` row under a tag the
 * pick is about to carry would be a second, contradictory fate for one span.
 * Only the wave leg (`src/waveTick.ts`), past the wall, has nothing to carry.
 */
export async function foldUncarriedAttempt(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<void> {
  await foldAttemptFacts(w, r);
  // `committed` carries the span's base and head (`AttemptOutcome`,
  // `src/tickAttempt.ts`), so the row always names what it is recovery for.
  // An uncommitted attempt left no span to re-pick: the ancestry refusal, the
  // in-worktree revert and the decline the fold above already stated are the
  // whole of what it has to say.
  if (!r.committed) return;
  w.mergeOutcomes.push({
    entryTag: r.entry.tag,
    outcome: "wave-walled",
    baseSha: r.spanBase,
    headSha: r.headSha,
  });
}

/**
 * The trunk half of one finished attempt, inside {@link mergeAttempt}'s ship
 * lock: the merge marker it stakes, the cherry-pick, the `afterMerge` gates
 * on the merged tip, the per-entry revert when one turns red, and the
 * `shipped` consult. Everything it observed there it records on the stage;
 * what the attempt observed before it is {@link foldAttemptFacts}'s.
 *
 * Answers with the merge-marker slug it staked, or `undefined` when it had
 * nothing to carry or refused before ever reaching the pick — the one fact
 * the caller needs to know whether a marker is standing for this entry once
 * the rewrite beside it has closed that marker's hazard.
 */
async function carrySpan(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<string | undefined> {
  // Nothing to carry: the attempt left no span on its branch — declined,
  // render-refused, reverted in its worktree. What it observed is already
  // folded ({@link foldAttemptFacts}).
  if (!r.committed) return undefined;
  const { leg, phase } = w.setup;
  const repoRoot = leg.repoRoot;
  const afterMergeGates = phase.gates.filter((g) => g.when === "afterMerge");

  // spec/loop.md "Tip verify — one writer per branch, absorption at the
  // merge", "Harness-driven commits carry no expected-tip bookkeeping —
  // the claim refuses, git arbitrates": no sha comparison against a
  // recorded expectation. A live claim on the ref is a concurrent engine
  // instance and refuses exactly as a moved tip used to; absent one,
  // whatever moved trunk was not an engine, and the cherry-pick below
  // lands onto whatever tip is current — git's own conflict detection is
  // the only content arbiter left.
  const foreignClaim = await liveForeignClaimPid(repoRoot, leg.ownTipClaimPid);
  if (foreignClaim !== null) {
    leg.log.warn(
      `[flume] ${phase.name}: tip claimed by pid ${foreignClaim}; refusing to cherry-pick ${r.entry.tag}, entry stays pending`,
    );
    w.tipMoved = true;
    w.mergeOutcomes.push({
      entryTag: r.entry.tag,
      outcome: "tip-moved",
      baseSha: r.spanBase,
      headSha: r.headSha,
    });
    return undefined;
  }
  if (!w.checkpointAttempted) {
    // spec/loop.md "Crash equals stop": checkpoint whatever the
    // operator has staged/unstaged on the primary checkout before this
    // wave's first pick range begins — once per wave, not once per
    // entry, since a clean checkout stays clean across a wave's own
    // cherry-picks (only a conflict's `--abort`, now guarded, or a
    // gate revert resets anything).
    w.checkpointAttempted = true;
    w.bystanderCheckpointSha = await git.checkpointBystanderState(repoRoot);
  }
  const preCherry = await git.revParse(repoRoot);
  // spec/loop.md "Crash equals stop": stake the merge before the pick —
  // a death anywhere past this line leaves the marker standing, and the
  // next `loop` start refuses over it rather than picking
  // the same span onto trunk a second time.
  const slug = slugify(r.entry.tag);
  await writeMergingMarker(leg, r.entry, r.branch, r.spanBase);
  // The commits of this span trunk already held. A range pick absorbs those
  // rather than refusing over them (`git.cherryPickRange`), so only a real
  // conflict reaches the catch below.
  let absorbed: readonly string[] = [];
  try {
    // The per-entry leg's ancestry check already cleared the whole
    // `spanBase..headSha` span as one completed entry — cherry-pick
    // the whole range, in order, not just the newest commit
    // (spec/loop.md "The check is ancestry, and N commits are
    // completion"). Equivalent to a single-sha pick when the span
    // holds exactly one commit.
    ({ absorbed } = await git.cherryPickRange(repoRoot, r.spanBase, r.headSha));
  } catch (err) {
    const message = (err as Error).message;
    leg.log.warn(
      `[flume] cherry-pick failed for ${r.entry.tag}: ${message}; entry stays in pending`,
    );
    let footprint: string[] | undefined;
    try {
      footprint = await git.diffNameOnly(repoRoot, r.spanBase, r.headSha);
    } catch {
      // Footprint capture is best-effort; the retry just partitions on
      // declared files as before.
    }
    // Abort the in-progress cherry-pick so the working tree is clean for
    // subsequent ticks. Without this, partially-applied changes block
    // the next plan tick (which can't run `pnpm install` etc. against a
    // dirty trunk) and require manual `git restore` intervention.
    await git.cherryPickAbort(repoRoot);
    w.mergeOutcomes.push({
      entryTag: r.entry.tag,
      outcome: "cherry-pick-conflict",
      ...(footprint ? { footprint } : {}),
      baseSha: r.spanBase,
      headSha: r.headSha,
    });
    // A merge-stage failure — always entry-scoped, so
    // superviseLoop's quarantine leg can isolate it exactly like a
    // tagged provisioning failure.
    w.mergeFailures.push({
      ...blamedOn(r.entry),
      signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
      message,
    });
    return slug;
  }
  const mergedSha = await git.revParse(repoRoot);
  if (absorbed.length > 0) {
    // Absorbed, never a conflict (spec/loop.md "Tip verify — one writer per
    // branch, absorption at the merge"). Said out loud, because the span
    // reaching trunk with fewer commits than it carried — or, when
    // `mergedSha === preCherry`, with none — is otherwise only visible as a
    // merge row whose two shas are equal.
    leg.log.info(
      `[flume] ${r.entry.tag}: trunk already held ${absorbed.map((sha) => sha.slice(0, 8)).join(", ")} of ${r.spanBase.slice(0, 8)}..${r.headSha.slice(0, 8)}; absorbed, not a conflict`,
    );
  }

  // Gate this entry's merged commit. The first failing afterMerge gate
  // attributes the failure to *this* entry — it is the only delta
  // between `preCherry` and `mergedSha`, which now may span more than
  // one cherry-picked commit (spec/loop.md "The check is ancestry, and N
  // commits are completion") — diffed as a range rather than
  // `mergedSha`'s own single-commit show, so an earlier commit in the
  // span isn't missed. Computed once per commit and shared across every
  // gate this loop runs, and reused below as the `afterMerge-reverted`
  // footprint — the same dedup the afterCommit loop does in
  // `runAfterCommitGates` (`src/tickAttempt.ts`).
  const commitTouchedPaths = await git.diffNameOnly(
    repoRoot,
    preCherry,
    mergedSha,
  );
  let entryFailure: ReportedGateResult | undefined;
  // `mergeGateResults` is wave-cumulative (never reset per entry —
  // `allGateResults` at close needs the whole wave's worth). Capture this
  // entry's own starting offset so `ShipContext.gateResults` below can
  // slice out just the results this entry's own afterMerge loop appends,
  // never an earlier sibling's (spec/pending.md "Ship detection trusts the
  // agent's own account").
  const entryMergeGateResultsStart = w.mergeGateResults.length;
  for (const gate of afterMergeGates) {
    const { result: gr, ms } = await runGate(
      gate,
      {
        cwd: repoRoot,
        repoRoot,
        flumeDir: leg.flumeDir,
        stateRootRel: leg.stateRootRel,
        pendingDir: leg.pendingDir,
        configDir: leg.configDir,
        phaseName: phase.name,
        commitSha: mergedSha,
        touchedPaths: commitTouchedPaths,
        entry: r.entry,
        // This entry's own span base, not `preCherry`: the tip its agent
        // branched from, so an afterMerge gate reading trunk can tell an
        // input the entry ignored from one that landed after it started
        // (spec/chain.md "What a gate receives"). Sibling entries in the
        // same wave were provisioned from the same tip, and each carries
        // its own value regardless.
        baseSha: r.spanBase,
        // And `preCherry` beside it: the trunk tip this entry's span
        // landed onto, which is where the sibling that picked ahead of it
        // left trunk — the lower end of the range `commitTouchedPaths`
        // above is diffed over. A cumulative gate measuring trunk before
        // and after this entry reads its *before* here, never off the
        // wave-shared `baseSha` (spec/chain.md "What a gate receives").
        landedOnSha: preCherry,
        log: (l) => leg.log.info(l),
      },
      leg.gateScope,
    );
    const row = reportedGateRow(gate.name, gr);
    w.mergeGateResults.push(row);
    w.timings.push({ kind: "gate", gate: gate.name, ms });
    if (!gr.ok) {
      entryFailure = row;
      break;
    }
  }

  if (entryFailure) {
    leg.log.warn(
      `[flume] afterMerge gate '${entryFailure.gate}' failed for ${r.entry.tag}; reverting only that entry (clean siblings stay shipped)`,
    );
    // An afterMerge failure must surface to the agent, never vanish.
    // Capture the digest while the
    // cherry-picked SHA is still reachable, then drop ONLY this entry's
    // commit (reset to the pre-cherry-pick trunk), not the wave. The
    // entry stays pending; its retry carries this prior-attempt block.
    //
    // The digest covers `preCherry..mergedSha` — the span the pick added,
    // the same pair the merge row below bounds. Not `mergedSha` alone: over
    // a span trunk already held whole the two are equal, and digesting the
    // tip would hand the retry a sibling's or an operator's diff as its own
    // prior attempt (spec/loop.md "Prior-outcome feedback to the retrying
    // tick").
    const record = await buildGateRevert(
      "afterMerge",
      entryFailure,
      repoRoot,
      { base: preCherry, head: mergedSha },
    );
    await leg.attempts.write(priorAttemptRef(phase, r.entry), record);
    // The gate's own attribution decides the entry-scoped half: a gate
    // declaring `blamesSpan: false` leaves the failure unblamed, so the
    // run-scoped quarantine never holds this entry for a wall it was told
    // the entry did not build (spec/chain.md "What a gate returns"). Read
    // once, here, for every stage failure this refusal produces — the gate's
    // own row and either revert-refused row below. A revert only happens
    // because the gate refused, so a span the gate disowned is not answerable
    // for the collision its revert then hit either; blaming it there would
    // quarantine, by the back door, the entry the declaration withheld. The
    // revert itself still happens either way.
    const blame = entryFailure.blamesSpan === false ? {} : blamedOn(r.entry);
    w.gateFailures.push({
      ...blame,
      signature: gateFailureSignature(entryFailure),
      message: entryFailure.message,
    });
    // Both refusals below — trunk having moved out from under the merged
    // commit, and `resetKeepTo` itself refusing — end this entry the same
    // way: the commit stays on trunk for the operator, the entry is reported
    // refused, and the wave carries on. One spelling, two callers; each hands
    // in the stage failure its own refusal composes, and those words already
    // name the shas the warning would otherwise repeat
    // (`checkMergedTipUnmoved` (`src/tipVerify.ts`),
    // `unrevertableMergeFailure` (`src/tickVerdict.ts`)).
    const refuseRevert = (failure: {
      signature: string;
      message: string;
    }): string => {
      leg.log.warn(
        `[flume] ${r.entry.tag}: revert of ${mergedSha.slice(0, 8)} refused (${failure.message}); commit stays on trunk, left for the operator; other entries continue`,
      );
      w.revertRefused.push(r.entry);
      w.mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "afterMerge-revert-refused",
        footprint: commitTouchedPaths,
        baseSha: preCherry,
        headSha: mergedSha,
      });
      w.gateFailures.push({ ...blame, ...failure });
      return slug;
    };
    // spec/loop.md "Tip verify — one writer per branch, absorption at
    // the merge", "dropping it must not take bystanders": the primary
    // checkout may hold an operator's uncommitted work, so this reset
    // carries keep-semantics — never --hard — and a textual collision
    // refuses loudly rather than silently discarding either writer's
    // content. Caught here, not propagated: an uncaught throw would
    // abort the wave's remaining merges before `commitPendingUpdate`
    // ever ran, dropping the ledger rewrite for every sibling entry
    // already cherry-picked and shipped ahead of this one.
    const foreignTip = await checkMergedTipUnmoved(
      repoRoot,
      preCherry,
      mergedSha,
    );
    if (foreignTip)
      return refuseRevert({
        signature: bound(foreignTip.trim(), MAX_FAILURE_SIGNATURE),
        message: foreignTip,
      });
    try {
      await git.resetKeepTo(repoRoot, preCherry);
    } catch (err) {
      if (!(err instanceof git.ResetKeepRefusedError)) throw err;
      return refuseRevert(
        unrevertableMergeFailure({
          refusal: err.message,
          mergedSha,
          preCherry,
        }),
      );
    }
    w.mergeReverted.push(r.entry);
    w.mergeOutcomes.push({
      entryTag: r.entry.tag,
      outcome: "afterMerge-reverted",
      footprint: commitTouchedPaths,
      baseSha: preCherry,
      headSha: mergedSha,
    });
    return slug;
  }

  // Trunk holding the whole span leaves the pick nothing to add, and the
  // entry is merged all the same. `shipped` below is asked exactly as for any
  // other merge — whether work already on trunk ships is the chain's reading,
  // never the engine's (spec/loop.md "Tip verify — one writer per branch,
  // absorption at the merge").
  leg.log.info(
    mergedSha === preCherry
      ? `[flume] ${r.entry.tag}: trunk already holds the whole span ${r.spanBase.slice(0, 8)}..${r.headSha.slice(0, 8)}; merged with no commit to add`
      : `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
  );

  // Landing on trunk isn't shipping, and the engine does not decide
  // which of the two this is. It reports facts; the chain interprets
  // (spec/pending.md "Ship detection trusts the agent's own account";
  // .claude/rules/engine-boundary.md "Told, not inferred"). Undeclared
  // means shipped.
  let shipVerdict: boolean;
  // spec/chain.md "What a hook receives": a throwing `shipped` is not
  // `false`. The outcome is the one the seam already has for a predicate
  // that declines — entry stays pending, commit stays on trunk, merge
  // bookkeeping below completes — but the verdict names the throw, so a
  // broken predicate never reads back as a deliberate park.
  let shipThrew: string | undefined;
  try {
    shipVerdict =
      phase.shipped?.({
        entry: r.entry,
        mergedSha,
        baseSha: r.spanBase,
        touchedPaths: commitTouchedPaths,
        gateResults: [
          ...r.gateResults,
          ...w.mergeGateResults.slice(entryMergeGateResultsStart),
        ],
        worktreePath: r.worktreePath,
        repoRoot,
      }) ?? true;
  } catch (err) {
    shipThrew = throwFacts(err).message;
    shipVerdict = false;
  }
  if (!shipVerdict) {
    leg.log.warn(
      `[flume] ${r.entry.tag}: cherry-picked ${mergedSha.slice(0, 8)} but ${phase.name}.shipped ${shipThrew === undefined ? "returned false" : `threw: ${shipThrew}`} — commit stays on trunk, entry stays pending`,
    );
    // spec/loop.md "Prior-outcome feedback to the retrying tick": the
    // entry stays queued, so its next tick is a retry and gets the same
    // channel every other queue-unchanged outcome gets. Without it the
    // fact lives only in the verdict log, which a chain can only reach
    // by re-deriving "was the last attempt declined" from history —
    // exactly the rebuild `TickContext.priorAttempts` exists to spare
    // it. Cleared by the existing shipped-entry sweep below the moment
    // a later attempt ships clean. `shipThrew` rides it for the same
    // reason it rides the merge outcome below: the disk record is what
    // the *next* process reads, and a broken predicate collapsing into
    // "the chain parked this" is a wall the retry would invent.
    await leg.attempts.write(
      priorAttemptRef(phase, r.entry),
      buildNotShipped(mergedSha, commitTouchedPaths, shipThrew),
    );
    w.mergeOutcomes.push({
      entryTag: r.entry.tag,
      outcome: "not-shipped",
      baseSha: preCherry,
      headSha: mergedSha,
      ...(shipThrew === undefined ? {} : { threw: shipThrew }),
    });
    // A throw is a stage failure; a `false` is not. The run's accounting
    // reads this list, never the `not-shipped` outcomes above — the outcome
    // is the entry's fate, and re-filtering it for the throws would rebuild
    // beside the engine the split the engine already made
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*). Blamed by `blamedOn` unconditionally: the consult
    // only happens for a span this wave carried, so the entry is always
    // there, and a hook broken for one entry is exactly what the per-entry
    // leg exists to isolate.
    if (shipThrew !== undefined)
      w.shipFailures.push({
        ...blamedOn(r.entry),
        signature: bound(shipThrew.trim(), MAX_FAILURE_SIGNATURE),
        message: shipThrew,
      });
    return slug;
  }

  w.shipped.push(r.entry);
  w.mergeOutcomes.push({
    entryTag: r.entry.tag,
    outcome: "merged",
    baseSha: preCherry,
    headSha: mergedSha,
  });
  return slug;
}

/**
 * Close the stage once every attempt has been carried: the facts the wave leg
 * folds into its `TickResult` and its verdict.
 *
 * Nothing here touches trunk. Each pick landed its own ledger commit and
 * retired its own merge marker inside its own ship-lock hold
 * ({@link mergeAttempt}), so what is left of the stage is the fold over what
 * those picks observed.
 */
export function closeWaveMerge(w: WaveMerge): WaveMergeResult {
  // `revertRefused` is this stage's own bookkeeping — an entry whose gate
  // failed and whose revert off trunk was then refused — so the fold happens
  // here, beside the refusal verdict that folds the same three inputs, rather
  // than at a caller that would have to be handed a fourth array to restate
  // it (.claude/rules/engineering.md "Derived state is computed, never
  // restated beside its source").
  const noCommit = waveNoCommitCause(waveCommitted(w), w.attempts, [
    ...w.mergeReverted,
    ...w.revertRefused,
  ]);

  return {
    shipped: w.shipped,
    mergeReverted: w.mergeReverted,
    allGateResults: waveGateResults(w),
    timings: w.timings,
    committedWave: waveCommitted(w),
    ledgerShas: w.ledgerShas,
    mergeOutcomes: w.mergeOutcomes,
    mergeFailures: w.mergeFailures,
    gateFailures: w.gateFailures,
    shipFailures: w.shipFailures,
    tipMoved: w.tipMoved,
    declined: w.declined,
    ...(w.bystanderCheckpointSha
      ? { bystanderCheckpointSha: w.bystanderCheckpointSha }
      : {}),
    ...(noCommit ? { noCommit } : {}),
  };
}

/**
 * Every gate row this wave has produced so far — the attempts' own rows, then
 * this stage's afterMerge rows. Read by the stage's close and by a mid-wave
 * ledger refusal's verdict, so the two cannot describe one wave differently.
 */
function waveGateResults(w: WaveMerge): ReportedGateResult[] {
  return [...w.attemptGateResults, ...w.mergeGateResults];
}

/** Whether any span this wave has carried shipped. Same two readers. */
function waveCommitted(w: WaveMerge): boolean {
  return w.shipped.length > 0;
}

/**
 * One pick's ledger rewrite (`commitPendingUpdate`, `src/pendingLedger.ts`),
 * inside the ship-lock hold that pick already owns: retire the tag if it
 * shipped, drain the `blockedBy` gates it was holding, record the footprint a
 * failed merge observed, and commit the result.
 *
 * Scoped to this pick's own records rather than the wave's. A wave is a
 * rolling series of merges, so a rewrite deferred to its end leaves a queue on
 * disk listing entries already on the trunk for as long as the slowest agent
 * runs (`spec/worktrees.md`, *Fanout and worktrees — provisioning, isolation,
 * teardown*).
 *
 * Records the refusal on the stage and re-throws the cause when the rewrite
 * refuses: this pick and every pick before it are already on trunk, so the
 * facts naming them ride the error out of the leg rather than vanishing with
 * it — built once the siblings the wave is still carrying have settled
 * ({@link waveMergeError}), which is the wave leg's own throw site
 * (`src/waveTick.ts`).
 */
async function commitAttemptLedger(
  w: WaveMerge,
  shippedNow: readonly PendingEntry[],
  outcomesNow: readonly TickVerdictMergeOutcome[],
): Promise<void> {
  const { leg, phase, partitionIgnore } = w.setup;
  // `commitPendingUpdate` derives the footprints straight off these merge
  // outcomes, the same records this wave's TickVerdict carries — no separate
  // observed-files bookkeeping here.
  const footprintTags = outcomesNow.flatMap((m) =>
    m.entryTag && m.footprint && m.footprint.length > 0 ? [m.entryTag] : [],
  );
  if (shippedNow.length === 0 && footprintTags.length === 0) return;
  // A shipped entry committed clean *and* passed its afterMerge gate — clear
  // any stale prior-attempt slot so its next plan/build cycle starts with no
  // false signal.
  for (const s of shippedNow) {
    await leg.attempts.clear(priorAttemptRef(phase, s));
  }
  const shippedTags = shippedNow.map((s) => s.tag);
  // The rewrite can refuse, and every way it does propagates past the wave's
  // worktree cleanup, straight to `tick()`'s catch. Its read is the strict
  // `readPending()` (.claude/rules/engineering.md "Loud or nothing"), so a
  // queue corrupted by something outside this tick in the window since the
  // wave's decide-read refuses rather than overwriting the file with a rewrite
  // derived from `[]`; and its commit is a `git commit --only` over the paths
  // it names, which fatals under a paused merge or cherry-pick in the primary
  // checkout and on a path git finds unchanged. Already-shipped commits stay
  // on trunk in every case. Surviving worktrees are the accepted cost of
  // refusing rather than proceeding; the next `pruneWorktrees` call reclaims
  // their metadata once a human has cleared the refusal.
  let update: PendingRewriteResult;
  try {
    update = await commitPendingUpdate(
      leg,
      shippedTags,
      outcomesNow,
      partitionIgnore,
    );
  } catch (err) {
    // The verdict for this refusal is built where the wave has settled, not
    // here (`waveMergeError`): a slot still running can fold a decline or
    // raise a render refusal behind this pick, and a verdict built at this
    // point names neither (spec/loop.md "The tick verdict — one facts
    // artifact"). The cause goes on the stage and travels bare, since the
    // wave leg holds it beside throws that are not refusals at all.
    w.refusal = { cause: err };
    throw err;
  }
  // Appended, never overwritten: a wave lands one of these per pick, and the
  // handoff reports the set beside the single sha it narrows to
  // (.claude/rules/engineering.md "A fact the engine holds is reported, never
  // rediscovered"). Whether there is one to append is the rewrite's own answer
  // — the same rule, one call down: three of its four exits write no commit,
  // and a tip comparison around this call cannot tell the wave's own sibling
  // pick landing beside it from a commit this rewrite made.
  if (update.exit === "committed") w.ledgerShas.push(update.commitSha);
  if (update.exit === "tip-claimed") {
    w.tipMoved = true;
    // The refusal's own disk state, from the call that took it rather than
    // from this site's memory of where its tip check sits: the claim is read
    // before the rewrite is written, so the queue at `update.path` is still
    // the one the call read — the operator has nothing to attribute here,
    // which is the half of this pair the commit refusal above cannot say
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*). The path is the ledger's own spelling, never
    // `plan/pending` restated here over a location the chain chose.
    leg.log.warn(
      `[flume] ${phase.name}: tip claimed before the pending-ledger commit; ` +
        `${update.path} is unchanged on disk, no rewrite written — ` +
        `shipped entries already on trunk stay shipped`,
    );
    return;
  }
  // Same fact again, so the line an operator reads and the sha the handoff
  // carries can never disagree: a no-commit exit says so in words, and a sha
  // is quoted only where the rewrite reported one. Which no-commit exit is the
  // rewrite's own statement, never a cause keyed off the one `undefined` all
  // three of them answer with — read off the sha alone, a queue whose fresh
  // re-read no longer carries the shipped entry's file was reported as an
  // out-of-tree dock, and a relocated dock that had just written the queue was
  // reported as a footprint already recorded
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*).
  leg.log.info(
    update.exit === "committed"
      ? shippedTags.length > 0
        ? `[flume] ship commit ${update.commitSha.slice(0, 8)}: ${shippedTags.join(", ")}`
        : `[flume] footprint commit ${update.commitSha.slice(0, 8)}: ${footprintTags.join(", ")}`
      : noCommitLine(update.exit, shippedTags, footprintTags),
  );
}

/**
 * The operator line for a ledger rewrite that wrote no commit: what the queue
 * this pick was about to move is now, in the words of the exit the rewrite
 * reported (`PendingRewriteNoCommitExit`, `src/pendingLedger.ts`).
 *
 * `tip-claimed` never reaches here — its caller above returns on the warning
 * that names the claim — so the two arms left are the two states an operator
 * has to tell apart: a queue that already said what this rewrite would have
 * said, and a queue written to a dock git cannot see.
 */
function noCommitLine(
  exit: PendingRewriteNoCommitExit,
  shippedTags: string[],
  footprintTags: string[],
): string {
  const subject =
    shippedTags.length > 0
      ? `shipped ${shippedTags.join(", ")}`
      : `footprints for ${footprintTags.join(", ")}`;
  return exit === "dock-outside-repo"
    ? `[flume] ${subject}; pending updated on disk, no chore commit (dock outside repo)`
    : `[flume] ${subject}; pending already up to date, no commit`;
}

/**
 * The error this wave leaves with, at the point every slot it opened has
 * finished: a ledger rewrite that refused becomes the
 * {@link WaveLedgerRefusal} carrying this wave's facts as they *settled*, and
 * any other merge throw passes through untouched.
 *
 * Called from the wave leg's own throw site rather than from the refusing pick
 * (`src/waveTick.ts`): the refusal stops the wave carrying any further span,
 * but the siblings already running still settle behind it, and a decline
 * folded or a render refusal raised in that window is a fact of this tick. A
 * verdict built at the pick names whichever of them happened to have landed
 * first (spec/loop.md "The tick verdict — one facts artifact").
 */
export async function waveMergeError(
  w: WaveMerge,
  err: unknown,
): Promise<unknown> {
  if (w.refusal === undefined) return err;
  return new WaveLedgerRefusal(
    w.refusal.cause,
    await settledWaveVerdict(w, w.refusal.cause, "pending-ledger rewrite refused"),
  );
}

/**
 * The error a wave torn down by one of its own slots leaves with, at the same
 * point and for the same reason as {@link waveMergeError}: whatever the slot
 * leg threw, the spans the wave carried before it are already on trunk and
 * every agent that ran has already left a usage row. Unwrapped, all of that
 * goes with the throw — the carry is what keeps it
 * (`spec/loop.md`, "The tick verdict — one facts artifact").
 *
 * Every cause leaves wrapped, because every cause leaves the same facts
 * behind. What the cause decides is only *which* carry: a freed slot's
 * decide-read over a queue this phase's fence does not admit refuses with a
 * `PendingParseFailure` (`readPendingForDecision`, `src/pendingLedger.ts`)
 * and is a ledger refusal, which `tick()` classifies; an agent that exploded,
 * a hook that threw, a render that did not resolve refused no ledger, and
 * takes the base carry — reported as no ledger refusal at all rather than
 * assigned one this site would have to invent.
 */
export async function waveSlotThrow(
  w: WaveMerge,
  err: unknown,
): Promise<WaveCarriedThrow> {
  const ledger = err instanceof PendingParseFailure;
  const verdict = await settledWaveVerdict(
    w,
    err,
    ledger ? "mid-wave queue re-read refused" : "a slot leg threw",
  );
  return ledger
    ? new WaveLedgerRefusal(err, verdict)
    : new WaveCarriedThrow(err, verdict);
}

/**
 * The verdict a torn-down wave carries out, built from the wave facts as they
 * stand when its last slot has finished (spec/loop.md "The tick verdict — one
 * facts artifact"). This wave's shipped tags are already real — cherry-picked
 * and afterMerge-gated onto trunk — and every agent that ran has already left
 * its usage row; a thrown error is the only channel left once the wave leg
 * never returns, so the verdict rides it instead of being discarded the way a
 * plain re-throw would.
 *
 * Built for every throw out of a wave, never the parse failure alone: the
 * tags on trunk are the same facts whichever cause tore it down, and keying
 * the carry on a cause is how a `git commit --only` fatal — or a disk error,
 * or an `index.lock`, or an agent that exploded — came to lose a verdict the
 * parse failure's sibling arm kept. Which cause it was travels on the error
 * that carries this, for `tick()` to classify.
 *
 * `event` is what happened, in the operator's words, for the one summary line
 * the verdict carries: the callers are the rewrite behind a pick
 * ({@link waveMergeError}) and a slot leg that threw ({@link waveSlotThrow}),
 * and an operator reading the verdict has different repairs for them.
 */
async function settledWaveVerdict(
  w: WaveMerge,
  cause: unknown,
  event: string,
): Promise<TickVerdict> {
  const {
    leg,
    phase,
    provisioned,
    provisionFailures,
    renderFailures,
    platformFailures,
    stakeLosses,
    clearedPriorAttempts,
  } = w.setup;
  const why = refusalMessage(cause);
  const shippedTags = w.shipped.map((s) => s.tag);
  const committed = waveCommitted(w);
  return buildTickVerdict({
    phaseName: phase.name,
    tags: provisioned.map((e) => e.tag),
    committed,
    noCommit: waveNoCommitCause(committed, w.attempts, [
      ...w.mergeReverted,
      ...w.revertRefused,
    ]),
    tipMoved: w.tipMoved,
    declined: w.declined,
    bystanderCheckpointSha: w.bystanderCheckpointSha,
    gateResults: waveGateResults(w),
    timings: w.timings,
    shippedTags,
    mergeOutcomes: w.mergeOutcomes,
    // spec/loop.md "Every agent invocation leaves a usage row": composed from
    // the rows this wave's agents already wrote, never a second copy the
    // stage carried — the rows on disk are the set, and a wave torn down
    // mid-flight reports exactly the ones it had paid for.
    invocations: await readInvocationRows(leg.flumeDir, phase.name),
    provisionFailures,
    renderFailures,
    stakeLosses,
    mergeFailures: w.mergeFailures,
    gateFailures: w.gateFailures,
    shipFailures: w.shipFailures,
    platformFailures,
    clearedPriorAttempts,
    summary:
      shippedTags.length > 0
        ? `${phase.name} shipped ${shippedTags.join(", ")} — ${event} (${why})`
        : `${phase.name}: ${event} (${why})`,
    // headSha: nothing that tore this wave down reached a commit of its own,
    // so the tip has not moved past what this wave's picks already landed — a
    // fresh read rather than the pre-throw sha the caller holds, so this
    // stays correct if a future revision moves the read point.
    headSha: await git.revParse(leg.repoRoot),
  });
}

/**
 * spec/loop.md "Crash equals stop": stake this entry's merge before the
 * pick runs. The marker is the engine's own statement that a span is
 * mid-flight — what makes an interrupted merge a fact the next start reads
 * off disk instead of an inference from commit shape
 * (`.claude/rules/engine-boundary.md`, "Told, not inferred"; "Evidence
 * must be durable").
 */
async function writeMergingMarker(
  leg: TickLegContext,
  entry: PendingEntry,
  branch: string,
  baseSha: string,
): Promise<void> {
  const marker: MergingMarker = { tag: entry.tag, branch, baseSha };
  await mkdir(namespacedJoin(mergingDir(leg.flumeDir)), { recursive: true });
  await writeFile(
    namespacedJoin(mergingMarkerPath(leg.flumeDir, slugify(entry.tag))),
    JSON.stringify(marker),
    "utf8",
  );
}

/**
 * Retire one pick's marker, once the hazard it names is closed.
 *
 * The wait point is the ship bookkeeping spec/loop.md "Crash equals stop"
 * names — this entry's ledger rewrite and the prior-attempt record clear that
 * rides with it, both inside the same ship-lock hold as the pick itself. The
 * verdict is not part of it and no marker is held for it: `Dispatcher.tick()`
 * never writes the verdict, the CLI's `tick` command does, after `tick()` has
 * returned (`writeTickVerdict` (`src/tickVerdict.ts`)). The ledger rewrite is
 * also where the hazard closes — once the queue no longer carries a picked
 * entry as `open`, a crash before the verdict write leaves nothing a second
 * run would pick again, and refusing over it would be a false refusal. A
 * ledger rewrite that *refused* (`WaveLedgerRefusal`) throws past this call,
 * so its marker survives exactly as a crash's would.
 */
async function retireMergingMarker(
  leg: TickLegContext,
  slug: string,
): Promise<void> {
  await rm(namespacedJoin(mergingMarkerPath(leg.flumeDir, slug)), {
    force: true,
  });
}
