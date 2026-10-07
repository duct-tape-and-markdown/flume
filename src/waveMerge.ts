/**
 * The merge stage of a wave: everything a `fanout` phase does to trunk with a
 * per-entry attempt once that entry's agent has finished. It takes one
 * attempt at a time and carries its span across — the merge marker it stakes,
 * the carry itself (`carryMergeSpan`, `src/mergeSpan.ts`), the `shipped`
 * consult, and the pending-ledger rewrite (`src/pendingLedger.ts`) that
 * retires that one entry and records what it touched — answering the merge
 * outcomes, gate rows and failure records the wave's verdict is folded from.
 *
 * The carry is what a singleton phase's merge runs too, so what is a wave's
 * own here is the per-entry vocabulary around it: rows and records under a
 * tag, blame the run quarantine can hold, and a queue that stops listing what
 * is already on the trunk.
 *
 * Three calls, not one, because a span is carried **as its own agent
 * finishes** rather than after the batch settles (`spec/worktrees.md`,
 * *Fanout and worktrees — provisioning, isolation, teardown*): a wave never
 * waits on its slowest agent to merge its fastest. {@link openWaveMerge}
 * opens the stage, {@link offerAttempt} takes one finished attempt and
 * {@link drainWaiting} carries what is waiting, and
 * {@link closeWaveMerge} folds what they observed. Only the middle one
 * touches trunk, and the ledger commit rides inside its hold: a wave can
 * outlast many merges, and a queue that went on listing an entry already on
 * the trunk would be read as current by every producer beside it. One
 * ship-lock span per pick — taken when the pick begins and released however
 * it leaves, shipped, reverted or thrown as a {@link WaveCarriedThrow} — so
 * a sibling tick gets its turn between two of this wave's picks and reads a
 * queue that matches the trunk it is looking at. What one span learned and
 * the next needs is {@link WaveMerge}.
 *
 * Its caller is the wave leg (`src/waveTick.ts`), which selects the batch,
 * provisions the worktrees, runs the fanout, serializes these calls behind
 * each finishing agent, and tears the worktrees down after them.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";

import * as git from "./git.js";
import {
  carryMergeBatch,
  carryMergeSpan,
  type BystanderCheckpoint,
} from "./mergeSpan.js";
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
import { buildNotShipped, priorAttemptRef } from "./priorAttempts.js";
import { blamedOn } from "./selection.js";
import type { AttemptOutcome } from "./tickAttempt.js";
import type { TickLegContext } from "./tickLeg.js";
import {
  buildTickVerdict,
  appendInvocationRow,
  readInvocationRows,
  stageFailureFacts,
  startTiming,
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
  type UnclassedWall,
  type WaveWallEvent,
} from "./tickVerdict.js";
import { thrownMessage } from "./thrown.js";

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
 * One provisioned fanout entry's fate, as {@link offerAttempt} reads it: the
 * attempt's own outcome plus the entry and worktree facts the merge stage
 * acts on. `declined` is the one fate that never reaches an attempt —
 * `shouldRun` turned this entry away before the render.
 */
export type EntryAttempt = AttemptOutcome & {
  entry: PendingEntry;
  /**
   * The entry's steps, as the queue listing its slot pulled from held them —
   * `ShipContext.steps`, and with the entry itself the set of tags this span
   * may ship (spec/pending.md "Ship detection trusts the agent's own
   * account"). Carried out of the per-entry leg for the reason the branch
   * below is: the merge stage is fed one finished attempt at a time and holds
   * no listing of its own to walk.
   */
  steps: readonly PendingEntry[];
  /** This entry's worktree, still on disk when the merge stage classifies it — `ShipContext.worktreePath`. */
  worktreePath: string;
  /**
   * This entry's private worktree branch — the ref its span sits on until
   * the merge stage picks it. Carried out of the per-entry leg because the
   * merge marker (spec/loop.md "Crash equals stop") names the branch an
   * interrupted pick left standing, and the slot that provisioned the
   * worktree is the only holder of its branch: the merge stage is fed one
   * finished attempt at a time, never a wave-wide list it could look the
   * branch up in.
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
 * classification: a slot leg, or a merge stage, that threw outside any ledger
 * call refused no ledger, and naming one for it would be a verdict invented at
 * the carry
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
    super(thrownMessage(cause), { cause });
    this.name = "WaveCarriedThrow";
    this.verdict = verdict;
  }
}

/**
 * The carry for the causes that *are* a pending-ledger refusal —
 * `commitPendingUpdate`'s rewrite behind a pick, or the decide re-read a freed
 * slot takes over a queue this phase's fence cannot rewrite (`refillRead` in
 * `src/waveTick.ts`). The rewrite read that would not parse is one of them; so
 * is the `git commit --only` that fatals on a partial commit under a paused
 * merge or cherry-pick, a named path git finds unchanged, a disk error, a lost
 * `index.lock`. The rewrite's carry is widened to the call rather than keyed
 * on a cause, because every cause leaves the same tags on trunk. Which wall a
 * wave holding more than one leaves as is {@link waveWall}'s ranking.
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
 * Wave-level no-commit cause, only meaningful when the wave shipped
 * nothing usable — shared by the wave's normal-completion verdict and by the
 * partial verdict a walled wave rides out on, whatever threw to wall it
 * ({@link settledWaveVerdict}) (.claude/rules/engineering.md "Derived state
 * is computed, never restated beside its source"), so a wall reports the
 * same cause a clean completion would have. The precedence is
 * {@link WAVE_NO_COMMIT_RANK}.
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
 * leg and phase every pick runs against, the wave facts the partial verdict
 * of a walled wave has to name — the batch that was provisioned, the
 * provisioning walls already recorded, the entries a sibling took before the
 * stake reached them, and the records the wave's opening queue read retired —
 * since that verdict is assembled inside the stage
 * ({@link settledWaveVerdict}) and never reaches the leg's own return,
 * whatever threw to wall the wave.
 *
 * The attempts are not here. A wave hands them over one at a time, each as
 * its own agent finishes ({@link offerAttempt}), so the set is not known
 * when the stage opens.
 */
interface WaveMergeSetup {
  readonly leg: TickLegContext;
  readonly phase: Phase;
  /** Every entry this wave provisioned a worktree for, reached or not. */
  readonly provisioned: readonly PendingEntry[];
  /** The chain's footprint-ignore list, as the ledger rewrite consumes it. */
  readonly partitionIgnore: string[];
  /**
   * How many of this wave's finished spans one merge may carry
   * (spec/worktrees.md, *Batched merges*) — the chain's `mergeBatch` read
   * against this phase's `afterMerge` gates, which is the one derivation of it
   * (`mergeBatchWidth`, `src/gateBatch.ts`). `1` is the serial carry every
   * chain gets until both declarations agree, and the wave leg reads the width
   * off the tick's own resolved chain rather than this stage re-resolving one.
   */
  readonly mergeWidth: number;
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
 * advanced once per finished attempt by {@link offerAttempt} and
 * {@link drainWaiting}, closed by
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
/**
 * One finished attempt waiting on the ship lock: the attempt itself and the
 * merge-outcome rows its fold already produced, which the ledger commit of
 * whichever merge carries it has to record (spec/worktrees.md, *Batched
 * merges*).
 */
interface WaitingSpan {
  readonly attempt: EntryAttempt;
  /** See {@link foldAttemptFacts}'s answer. */
  readonly folded: readonly TickVerdictMergeOutcome[];
}

/**
 * A waiting attempt that left a span to pick, with the range already read off
 * it. The pair is on {@link EntryAttempt} only for an attempt that committed
 * (`AttemptOutcome`, `src/tickAttempt.ts`), so it is read where the narrowing
 * holds — once, in the drain — rather than re-asserted at each site a batch
 * hands it to.
 */
interface BatchCandidate {
  readonly attempt: EntryAttempt;
  /** The span's base — the tip its agent branched from. */
  readonly base: string;
  /** The span's head — the last commit its agent left on its worktree branch. */
  readonly head: string;
}

interface WaveMerge {
  readonly setup: WaveMergeSetup;
  /**
   * Every attempt this stage was handed, in the order their agents
   * finished — the set {@link waveNoCommitCause} folds and whose per-entry
   * gate rows {@link closeWaveMerge} folds.
   */
  readonly attempts: EntryAttempt[];
  /**
   * The spans handed over and not yet carried — what "waiting on the ship lock"
   * is, on disk nowhere and in memory here (spec/worktrees.md, *Batched
   * merges*). A merge reads the front of it once it holds the lock, so this
   * tick's own finished spans are the only candidates a batch has: a sibling
   * tick's are in that tick's queue and merge on their own.
   */
  readonly waiting: WaitingSpan[];
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
  /**
   * spec/loop.md "The tick verdict — one facts artifact": the trunk tip as
   * this wave's **last ship** left it, re-read under the ship lock that
   * carried it once that pick's `afterMerge` gates had passed and its ledger
   * commit had landed ({@link drainWaiting}). Overwritten by each later pick
   * that ships, so what survives the wave is the last one; `undefined` while
   * nothing has shipped.
   *
   * A read rather than `ledgerShas`' last element: three of the rewrite's four
   * exits write no commit, and the tip after one of those is the merged sha
   * the pick landed — a fact only git holds at that moment
   * (`.claude/rules/engineering.md`, *Derived state is computed, never
   * restated beside its source*). The fourth, `tip-claimed`, takes no read at
   * all: a foreign engine holds the tip, so the ref under this hold is not
   * this tick's to report as gated.
   */
  gatedTip: string | undefined;
  /** A tip claim or a per-entry ancestry refusal stopped at least one span. */
  tipMoved: boolean;
  /** `shouldRun` declined at least one entry. */
  declined: boolean;
  /**
   * spec/loop.md "Crash equals stop": this wave's one checkpoint over the
   * operator's uncommitted work, taken lazily by the first span it carries and
   * read at close. Its once-per-carrier mechanics are the carry's
   * ({@link BystanderCheckpoint}).
   */
  readonly checkpoint: BystanderCheckpoint;
  /**
   * The cause a pick's ledger rewrite refused with, boxed so that "refused"
   * is readable whatever the cause is; `undefined` while none has.
   *
   * Held on the stage because it is what tells the stage's two carries apart:
   * every throw out of the merge stage leaves wrapped, and a re-thrown cause
   * at the wave leg's throw site is indistinguishable there from a marker the
   * disk refused or a record the store would not write — so the ledger class
   * one of them reports is stated by the call that took the refusal rather
   * than read back off the cause
   * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). The verdict
   * either carry rides is built where the wave has *settled* — every slot
   * finished ({@link waveWallThrow}).
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
  /** See {@link WaveMerge.gatedTip}; absent while this wave shipped nothing. */
  readonly gatedTip?: string;
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
    waiting: [],
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
    gatedTip: undefined,
    tipMoved: false,
    declined: false,
    checkpoint: { attempted: false, sha: undefined },
    refusal: undefined,
  };
}

/**
 * Hand one finished attempt to the merge stage: everything it observed away
 * from trunk, folded now ({@link foldAttemptFacts}), and the span itself joined
 * to the queue of spans waiting on the ship lock.
 *
 * Called the moment an agent returns, off the queue that serializes the merges
 * (`src/waveTick.ts`), which is why the fold is here rather than inside the
 * carry: a usage row is paid for as its agent finishes and must not wait behind
 * a lock a sibling tick may hold for the length of its own merge span
 * (spec/loop.md "Every agent invocation leaves a usage row").
 *
 * Enqueueing is what makes a batch possible at all (spec/worktrees.md, *Batched
 * merges*): the next merge reads this queue once it holds the lock, so a span
 * that finished while an earlier merge was running is there to be carried with
 * whatever the merge takes next, rather than behind it.
 */
export async function offerAttempt(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<void> {
  const folded = await foldAttemptFacts(w, r);
  w.waiting.push({ attempt: r, folded });
  // The queue depth as this attempt joined it — the fact the next merge reads
  // to decide how wide it runs, said out loud because it is otherwise visible
  // only as a gate that was handed more than one span
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*). One line per entry per wave, and the boundary an
  // operator reads a slow wave at: where its agent stopped and its merge began.
  w.setup.leg.log.info(
    `[flume] ${w.setup.phase.name}: ${r.entry.tag} is done; ` +
      `${w.waiting.length} span(s) waiting on the ship lock, ` +
      `${w.setup.mergeWidth} per merge`,
  );
}

/**
 * Carry the next merge's worth of waiting spans onto trunk, under one ship lock
 * (spec/loop.md "The ship lock and the worktree lock — sibling ticks take
 * turns at git"): the merge markers they stake, the cherry-picks, the
 * `afterMerge` gates on the merged tip, the revert when one turns red, the
 * `shipped` consults, and the ledger commits retiring what landed.
 *
 * Driven once per offered attempt rather than once per wave
 * (`src/waveTick.ts`), so a two-minute entry reaches trunk without waiting on a
 * fifteen-minute sibling. The lock is the merge: it is taken here and released
 * before this returns, so a sibling tick — or this same wave's next drain —
 * picks onto the trunk as it then stands. The caller serializes the calls; the
 * lock is a pid claim, so two of them in-flight in one process would wait on
 * each other forever.
 *
 * How many spans one call carries is {@link takeBatch}'s, and whether a batch
 * ships as one is {@link carryBatch}'s. A drain whose waiting queue is already
 * empty — every span of it carried by an earlier drain's batch — returns
 * having touched nothing, which is the shape that makes one drain per offered
 * attempt safe at any width.
 *
 * The offending entry of a red single-span `afterMerge` gate is the one whose
 * cherry-pick turned it red — nothing else changed since its pre-cherry-pick
 * trunk — so revert *only* its commit (reset to that point) and leave it
 * pending. Siblings already on trunk stay shipped; siblings merged after are
 * evaluated against the trunk without the reverted commit. No `reset --hard`
 * back to the tip the wave was provisioned from, so no whole-wave blast
 * radius: one flaky merge-time gate does not kill N−1 clean commits.
 */
export async function drainWaiting(w: WaveMerge): Promise<void> {
  // Nothing has been offered since the last drain emptied the queue, so there
  // is no lock to take: every span this drain would have carried is already on
  // trunk through an earlier batch.
  if (w.waiting.length === 0) return;
  const { leg } = w.setup;
  // spec/loop.md "The ship lock and the worktree lock — sibling ticks take
  // turns at git": one merge at a time across this run's sibling ticks. The
  // cherry-picks, the `afterMerge` judges that read the merged tip, the revert
  // that may follow and the ledger rewrites that retire the tags all touch
  // trunk — so this drain's whole passage is the span, not each git call inside
  // it. A sibling holding it is waited on, never refused: it is this run's own
  // writer, and tip verify absorbs the tip it moved.
  //
  // spec/loop.md "The tick verdict — one facts artifact": the merge rows
  // partition this passage — the lock a sibling may still hold, the picks, the
  // gates, the reverts, the ship consults and the ledger commits — one row per
  // serial carry under its entry's tag, or one untagged row for a batch that
  // shipped as one, charged in the order they were carried
  // ({@link chargeMerge}).
  const drainElapsed = startTiming();
  const shipLock = await git.acquireShipLock(leg.repoRoot, leg.log);
  let charged = 0;
  // Read with the lock in hand, which is what makes the batch *the spans
  // waiting on the ship lock* (spec/worktrees.md, *Batched merges*) rather than
  // the ones that happened to be waiting before the wait began: a span that
  // finished while a sibling tick held the lock is carried by this merge
  // instead of by one behind it.
  const taken = takeBatch(w);
  /**
   * Close one row's share of this drain's clock: the time no row has closed
   * yet, under the tag it belongs to. The rows partition the whole passage, so
   * the lock a sibling held is charged to the first of them and the sum is what
   * the drain spent.
   *
   * A batch's row carries **no** tag, exactly as its gate context withholds the
   * entry: its picks, its one gate run and its one ledger commit are not one
   * entry's passage, and dividing them between the spans would be a number the
   * engine invented. A serial carry's row names its entry, which is every merge
   * on a chain that left `mergeBatch` alone.
   */
  const chargeMerge = (tag?: string): void => {
    const spent = drainElapsed() - charged;
    charged += spent;
    w.timings.push({
      kind: "merge",
      ...(tag === undefined ? {} : { entryTag: tag }),
      ms: spent,
    });
  };
  try {
    // The rows the folds already produced for the attempts of this drain — an
    // afterCommit revert's footprint reached no pick, so it rides the first
    // ledger commit this drain lands rather than waiting for a wave's end
    // (`.claude/rules/engineering.md`, *Loud or nothing*).
    let folded: TickVerdictMergeOutcome[] = taken.flatMap((s) => [...s.folded]);
    /**
     * One ledger commit for what the merge just landed, inside the hold that
     * landed it, never at the wave's end (`spec/worktrees.md`, *Fanout and
     * worktrees — provisioning, isolation, teardown*): the lock is released
     * below, and a queue still listing an entry in that gap would be read as
     * current by the sibling agents, concurrent ticks and operators looking at
     * the trunk it is already on.
     *
     * The folds' own rows ride the first commit this drain lands and no later
     * one, so a footprint reaches trunk exactly once.
     */
    const land = async (
      shipped: readonly PendingEntry[],
      rows: readonly TickVerdictMergeOutcome[],
    ): Promise<void> => {
      const all = [...folded, ...rows];
      folded = [];
      const exit = await commitAttemptLedger(w, shipped, all);
      // spec/loop.md "The tick verdict — one facts artifact": the gated tip
      // this ship left. Read here and nowhere else — inside the hold, after
      // the pick's `afterMerge` gates passed, its `shipped` consult said so
      // and the rewrite retiring it committed — because that is the only
      // instant at which trunk is a tip every gate has judged *and* no
      // sibling can have moved it. A read taken after the lock is released,
      // or at the wave's end, would be the tip some later pick or some
      // sibling tick left, reported as this ship's.
      //
      // Only a land that shipped moves it: a pick whose rewrite recorded a
      // failed merge's footprint alone lands a ledger commit over a tip
      // nothing shipped onto, and `headSha` is the field that reports that
      // one.
      //
      // And only a land whose rewrite was not stopped by a foreign tip claim.
      // That exit is the one case where the ref under this hold is not ours:
      // a concurrent engine instance has claimed the tip, so the sha a read
      // here would return may name a commit no gate of this tick judged. The
      // exit says so itself, off the call that took it rather than off a tip
      // comparison around it — `w.tipMoved` is the wave-level fact and is set
      // by the per-entry ancestry refusal too, which stops no rewrite
      // (`.claude/rules/engineering.md`, *A fact the engine holds is
      // reported, never rediscovered*).
      if (shipped.length > 0 && exit !== "tip-claimed")
        w.gatedTip = await git.revParse(leg.repoRoot);
    };
    // The attempts of this drain that left a span, with each range read where
    // `committed` narrows it ({@link BatchCandidate}).
    const spans: BatchCandidate[] = [];
    for (const { attempt } of taken) {
      if (!attempt.committed) continue;
      spans.push({ attempt, base: attempt.spanBase, head: attempt.headSha });
    }
    // spec/worktrees.md "Batched merges": one merge carrying several spans,
    // picked in order and gated once. Red, or a conflict while picking, puts
    // trunk back at the tip before the batch and the spans are merged one at a
    // time below — so the batch arm either ships everything it carried or
    // leaves the serial arm exactly the tree it would have started from.
    let batched = false;
    if (spans.length > 1) {
      try {
        batched = await carryBatch(w, spans, land);
      } finally {
        // Stamped however the batch left — shipped, unwound or thrown: every
        // way out of it is a merge that happened, and a red batch's one extra
        // gate run is the priced cost the section names, so it is on the
        // artifact rather than folded silently into the serial rows below
        // (spec/loop.md "The tick verdict — one facts artifact").
        chargeMerge();
      }
    }
    if (!batched) {
      for (const s of taken) {
        try {
          const span = await carrySpan(w, s.attempt);
          if (span.outcome) w.mergeOutcomes.push(span.outcome);
          w.shipped.push(...span.shipped);
          await land(span.shipped, span.outcome ? [span.outcome] : []);
          // spec/loop.md "Crash equals stop": the queue on disk now accounts
          // for this span, so the marker staked for it has nothing left to warn
          // the next start about — retired with the rewrite that closed its
          // hazard, never held for a wave that may still be running hours of
          // agents. A refusal above throws past this line, leaving the marker
          // standing exactly as a crash would.
          if (span.staked !== undefined)
            await retireMergingMarker(leg, span.staked);
        } finally {
          chargeMerge(s.attempt.entry.tag);
        }
      }
    }
  } finally {
    // Every way out of the passage: shipped, reverted, refused, or thrown. A
    // leaked lock names a pid that is still alive, so a sibling — and this
    // wave's own next drain — would wait on it for the rest of the run.
    shipLock.release();
  }
}

/**
 * The spans the next merge carries: the front of the waiting queue, up to
 * `mergeWidth` of the attempts that left a span (spec/worktrees.md, *Batched
 * merges*). Arrival order, which is agent-finish order, so the order spans
 * reach trunk is the order they were ready.
 *
 * An attempt that left **no** span — declined, render-refused, reverted in its
 * own worktree — is taken past the width rather than held back by it: it has no
 * pick to cost a batch anything, and what it does need is the footprint ledger
 * commit the drain lands under the lock either way.
 */
function takeBatch(w: WaveMerge): WaitingSpan[] {
  const taken: WaitingSpan[] = [];
  let spans = 0;
  while (w.waiting.length > 0) {
    const next = w.waiting[0]!;
    if (next.attempt.committed) {
      if (spans === w.setup.mergeWidth) break;
      spans++;
    }
    taken.push(w.waiting.shift()!);
  }
  return taken;
}

/**
 * The fold for the attempts a walled wave will never carry: everything each one
 * observed away from trunk ({@link offerAttempt} already took that), plus the
 * one fact only this leg can state — this span passed its afterCommit gates on
 * its own worktree branch and no pick was ever attempted over it. The base/head
 * pair is what makes it recoverable: the refusal leaves the branch standing,
 * the next start's teardown does not, and the verdict is where the sha outlives
 * the branch (spec/loop.md "The tick verdict — one facts artifact").
 *
 * Drains the queue, so the drains still chained behind a wall find nothing to
 * carry and the wave reports one `wave-walled` row per uncarried span rather
 * than one per drain that arrived after the wall.
 */
export function abandonWaiting(w: WaveMerge): void {
  for (const s of w.waiting.splice(0)) {
    // `committed` carries the span's base and head (`AttemptOutcome`,
    // `src/tickAttempt.ts`), so the row always names what it is recovery for.
    // An uncommitted attempt left no span to re-pick: the ancestry refusal, the
    // in-worktree revert and the decline the fold already stated are the whole
    // of what it has to say.
    if (!s.attempt.committed) continue;
    w.mergeOutcomes.push({
      entryTag: s.attempt.entry.tag,
      outcome: "wave-walled",
      baseSha: s.attempt.spanBase,
      headSha: s.attempt.headSha,
    });
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
 * Answers with the merge-outcome rows it pushed, for the ledger commit the
 * attempt's own carry lands: a footprint folded here reaches trunk only through
 * that rewrite, and a drain that read it back off `w.mergeOutcomes` by index
 * would be slicing an array its siblings push to concurrently
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
async function foldAttemptFacts(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<readonly TickVerdictMergeOutcome[]> {
  const rows: TickVerdictMergeOutcome[] = [];
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
    // trunk alone — and the teardown that follows this read is the
    // slot's own tail, one `await` past this fold (`settleSlot`,
    // `src/waveTick.ts`), so the set is readable here.
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
    // `carrySpan` reports, which is the shared trunk racing during this
    // wave's own merge step.
    rows.push({
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
      rows.push({
        entryTag: r.entry.tag,
        outcome: "afterCommit-reverted",
        footprint: r.footprint,
        ...(r.spanBase ? { baseSha: r.spanBase } : {}),
        ...(r.headSha ? { headSha: r.headSha } : {}),
      });
    }
    if (r.gateFailure) w.gateFailures.push(r.gateFailure);
  }
  w.mergeOutcomes.push(...rows);
  return rows;
}

/**
 * Carry several finished spans in one merge (spec/worktrees.md, *Batched
 * merges*): cherry-picked onto the tip in order, the `afterMerge` gates run
 * **once** over the result, and every span shipped in one ledger commit when
 * they are green.
 *
 * Answers whether the batch shipped. `false` is the fallback the section names
 * — red, or a conflict while picking — and by then trunk is back at the tip
 * before the batch, so the caller merges the same spans one at a time, gated
 * individually, and blame and revert stay per entry. The batch's own gate rows
 * stay on the stage either way: they name a run that happened and what it cost,
 * which is the one gate run more a red batch is priced at.
 *
 * No gate failure, no prior-attempt record and no merge outcome is recorded for
 * a batch that did not ship. Each is a per-entry verdict, and the serial pass
 * the caller runs next is what earns one per entry; a record written here would
 * name every span for a verdict one of them is answerable for.
 */
async function carryBatch(
  w: WaveMerge,
  spans: readonly BatchCandidate[],
  land: (
    shipped: readonly PendingEntry[],
    rows: readonly TickVerdictMergeOutcome[],
  ) => Promise<void>,
): Promise<boolean> {
  const { leg, phase } = w.setup;
  const entryMergeGateResultsStart = w.mergeGateResults.length;
  // The merge markers this batch stakes, one per span as its own pick begins,
  // retired at whichever exit closed their hazard — the ledger commit of a
  // green batch, or the reset of an unwound one.
  const staked: string[] = [];
  const batch = await carryMergeBatch({
    leg,
    phase,
    checkpoint: w.checkpoint,
    onGateRow: (row, ms) => {
      w.mergeGateResults.push(row);
      w.timings.push({ kind: "gate", gate: row.gate, ms });
    },
    spans: spans.map(({ attempt: r, base, head }) => ({
      base,
      head,
      entry: r.entry,
      steps: r.steps,
      stake: async () => {
        // spec/loop.md "Crash equals stop": each span's marker goes down before
        // its own pick, so a death anywhere inside the batch leaves a marker
        // for every span already on trunk and none for a span not yet picked.
        staked.push(slugify(r.entry.tag));
        await writeMergingMarker(leg, r.entry, r.branch, base);
      },
      narrate: {
        pickFailed: (message) =>
          `[flume] cherry-pick failed for ${r.entry.tag}: ${message}; the batch goes back off trunk and its spans merge one at a time`,
        absorbed: (shas) =>
          `[flume] ${r.entry.tag}: trunk already held ${shas.map((sha) => sha.slice(0, 8)).join(", ")} of ${base.slice(0, 8)}..${head.slice(0, 8)}; absorbed, not a conflict`,
        merged: (mergedSha, landedOnSha) =>
          mergedSha === landedOnSha
            ? `[flume] ${r.entry.tag}: trunk already holds the whole span ${base.slice(0, 8)}..${head.slice(0, 8)}; merged with no commit to add`
            : `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
      },
    })),
    narrate: {
      tipClaimed: (pid) =>
        `[flume] ${phase.name}: tip claimed by pid ${pid}; refusing to cherry-pick ${spans.map((s) => s.attempt.entry.tag).join(", ")}, entries stay pending`,
      gateFailed: (gate) =>
        `[flume] afterMerge gate '${gate}' failed over the batch of ${spans.length}; each span merges on its own so blame and revert stay per entry`,
      unwound: (why) =>
        `[flume] ${phase.name}: batch of ${spans.length} taken back off trunk (${why}); merging its spans one at a time`,
    },
  });
  if (batch.fate === "tip-moved") {
    // The shared trunk raced before this merge's first pick, so no span of the
    // batch is on trunk and none is retryable from a landed sha. Each span's
    // two shas are the whole recovery handle: the entry stays pending and its
    // commits outlive the branch teardown deletes. Reported per span rather
    // than once for the batch, because the refusal is every entry's fate
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*).
    w.tipMoved = true;
    const rows = spans.map(
      ({ attempt: r, base, head }): TickVerdictMergeOutcome => ({
        entryTag: r.entry.tag,
        outcome: "tip-moved",
        baseSha: base,
        headSha: head,
      }),
    );
    w.mergeOutcomes.push(...rows);
    await land([], rows);
    return true;
  }
  if (batch.fate === "unwound") {
    // The reset put trunk back at the tip before the batch, so nothing of these
    // spans is on trunk and the markers staked for them warn of nothing left.
    // Retired here rather than left for the serial pass to re-stake over: a
    // crash between the unwind and the first serial pick would otherwise refuse
    // the next start over spans the reset had already removed
    // (spec/loop.md "Crash equals stop").
    for (const slug of staked) await retireMergingMarker(leg, slug);
    return false;
  }
  // Green: every span is on trunk and the gates ruled over all of them, so the
  // `shipped` consult is the only verdict left and it is per span, asked with
  // that span's own facts and the batch's gate rows
  // ({@link consultShipped}).
  const shipped: PendingEntry[] = [];
  const rows: TickVerdictMergeOutcome[] = [];
  const gateResults = w.mergeGateResults.slice(entryMergeGateResultsStart);
  for (const [i, { attempt: r, base }] of spans.entries()) {
    const landed = batch.landed[i]!;
    const verdict = await consultShipped(w, r, base, landed, gateResults);
    shipped.push(...verdict.shipped);
    w.shipped.push(...verdict.shipped);
    rows.push(verdict.outcome);
  }
  w.mergeOutcomes.push(...rows);
  // One ledger commit for the whole batch (spec/worktrees.md, *Batched
  // merges*), landed inside the hold its picks ran in — and the markers it
  // staked retired with it, on {@link drainWaiting}'s serial terms.
  await land(shipped, rows);
  for (const slug of staked) await retireMergingMarker(leg, slug);
  return true;
}

/**
 * The trunk half of one finished attempt, inside {@link drainWaiting}'s ship
 * lock: the merge marker it stakes, the wave's reading of the carry its span
 * takes (`carryMergeSpan`, `src/mergeSpan.ts`), and the `shipped` consult a
 * landed span reaches. Everything it observed away from trunk is
 * {@link foldAttemptFacts}'s.
 *
 * The carry itself is the sequence a singleton phase's span takes too, so what
 * is left here is what only a wave has: a marker the next `loop` start reads,
 * rows and records under this entry's tag, the blame each failure it recorded
 * carries, and the consult that decides whether landing on trunk shipped.
 *
 * Answers with what this span leaves its drain to do: the merge-marker slug it
 * staked, if any; the one merge outcome it earned, if any; and the entries its
 * span shipped, empty where it shipped none. Returned rather than pushed onto the stage's arrays
 * alone, because the drain's ledger commit needs exactly this span's own rows
 * and those arrays are wave-cumulative.
 */
async function carrySpan(
  w: WaveMerge,
  r: EntryAttempt,
): Promise<{
  staked?: string;
  outcome?: TickVerdictMergeOutcome;
  /** The tags this span shipped, as entries — empty on every exit short of a ruled-on land. */
  shipped: readonly PendingEntry[];
}> {
  // Nothing to carry: the attempt left no span on its branch — declined,
  // render-refused, reverted in its worktree. What it observed is already
  // folded ({@link foldAttemptFacts}).
  if (!r.committed) return { shipped: [] };
  const { leg, phase } = w.setup;
  const ref = priorAttemptRef(phase, r.entry);
  // `mergeGateResults` is wave-cumulative (never reset per entry —
  // `allGateResults` at close needs the whole wave's worth). Capture this
  // entry's own starting offset so `ShipContext.gateResults` below can
  // slice out just the results this entry's own afterMerge gates append,
  // never an earlier sibling's (spec/pending.md "Ship detection trusts the
  // agent's own account").
  const entryMergeGateResultsStart = w.mergeGateResults.length;
  // Set by the stake below, so it names a marker exactly when one is standing:
  // a carry that refuses ahead of the pick never reaches its stake window.
  let staked: string | undefined;
  const carried = await carryMergeSpan({
    leg,
    phase,
    base: r.spanBase,
    head: r.headSha,
    entry: r.entry,
    // The slot's own listing of the entry's steps, already in hand for the
    // ship consult below: the gates over this span judge one session, and the
    // session's footprint is both (`GateContext.steps`, `src/Gate.ts`).
    steps: r.steps,
    ref,
    checkpoint: w.checkpoint,
    stake: async () => {
      // spec/loop.md "Crash equals stop": the marker goes down before the
      // pick — a death anywhere past it leaves the marker standing, and the
      // next `loop` start refuses over it rather than picking the same span
      // onto trunk a second time.
      staked = slugify(r.entry.tag);
      await writeMergingMarker(leg, r.entry, r.branch, r.spanBase);
    },
    onGateRow: (row, ms) => {
      w.mergeGateResults.push(row);
      w.timings.push({ kind: "gate", gate: row.gate, ms });
    },
    // The wave's own vocabulary: every line names the entry whose span this is
    // and what a refusal leaves it as, because a fanout tick's log is read for
    // which of N entries it is about.
    narrate: {
      tipClaimed: (pid) =>
        `[flume] ${phase.name}: tip claimed by pid ${pid}; refusing to cherry-pick ${r.entry.tag}, entry stays pending`,
      pickFailed: (message) =>
        `[flume] cherry-pick failed for ${r.entry.tag}: ${message}; entry stays in pending`,
      absorbed: (shas) =>
        `[flume] ${r.entry.tag}: trunk already held ${shas.map((sha) => sha.slice(0, 8)).join(", ")} of ${r.spanBase.slice(0, 8)}..${r.headSha.slice(0, 8)}; absorbed, not a conflict`,
      gateFailed: (gate) =>
        `[flume] afterMerge gate '${gate}' failed for ${r.entry.tag}; reverting only that entry (clean siblings stay shipped)`,
      // The bare refusal, with both shas short and named once each: the same
      // sentence a singleton's leg reads (`src/singletonTick.ts`), plus the
      // tail only a wave has to say.
      revertRefused: ({ mergedSha, landedOnSha, refusal }) =>
        `[flume] ${r.entry.tag}: revert of ${mergedSha.slice(0, 8)} back to ${landedOnSha.slice(0, 8)} refused (${refusal}); commit stays on trunk, left for the operator; other entries continue`,
      merged: (mergedSha, landedOnSha) =>
        mergedSha === landedOnSha
          ? `[flume] ${r.entry.tag}: trunk already holds the whole span ${r.spanBase.slice(0, 8)}..${r.headSha.slice(0, 8)}; merged with no commit to add`
          : `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
    },
  });
  if (carried.fate === "tip-moved") {
    // The shared trunk raced during this wave's own merge step, distinct from
    // the per-entry ancestry refusal {@link foldAttemptFacts} rows as
    // `dropped-work`. The span's two shas are the whole recovery handle: the
    // entry stays pending and its commits outlive the branch teardown deletes.
    w.tipMoved = true;
    return {
      ...(staked === undefined ? {} : { staked }),
      shipped: [],
      outcome: {
        entryTag: r.entry.tag,
        outcome: carried.fate,
        baseSha: r.spanBase,
        headSha: r.headSha,
      },
    };
  }
  if (carried.fate === "cherry-pick-conflict") {
    // A merge-stage failure — always entry-scoped, so
    // superviseLoop's quarantine leg can isolate it exactly like a
    // tagged provisioning failure.
    w.mergeFailures.push({ ...blamedOn(r.entry), ...carried.failure });
    return {
      ...(staked === undefined ? {} : { staked }),
      shipped: [],
      outcome: {
        entryTag: r.entry.tag,
        outcome: carried.fate,
        // The footprint the carry captured off the span's own two commits, which
        // is what `commitPendingUpdate` (`src/pendingLedger.ts`) lands on trunk
        // for the retry to partition against.
        ...(carried.footprint ? { footprint: carried.footprint } : {}),
        baseSha: r.spanBase,
        headSha: r.headSha,
      },
    };
  }
  if (
    carried.fate === "afterMerge-reverted" ||
    carried.fate === "afterMerge-revert-refused"
  ) {
    // The gate's own attribution decides the entry-scoped half: a gate
    // declaring `blamesSpan: false` leaves the failure unblamed, so the
    // run-scoped quarantine never holds this entry for a wall it was told
    // the entry did not build (spec/chain.md "What a gate returns"). Read
    // once, here, for every stage failure this refusal produced — the gate's
    // own row and the revert refusal beside it. A revert only happens because
    // the gate refused, so a span the gate disowned is not answerable for the
    // collision its revert then hit either; blaming it there would
    // quarantine, by the back door, the entry the declaration withheld. The
    // revert itself still happened either way.
    const blame = carried.blamesSpan === false ? {} : blamedOn(r.entry);
    w.gateFailures.push({ ...blame, ...carried.gateFailure });
    if (carried.fate === "afterMerge-revert-refused") {
      // Never added to {@link WaveMerge.mergeReverted}: that array's tags feed
      // `revertedTags`, and claiming a revert that never happened would
      // misreport the tree. The commit stays on trunk for the operator, this
      // entry is reported refused, and the wave carries on.
      w.revertRefused.push(r.entry);
      w.gateFailures.push({ ...blame, ...carried.failure });
    } else {
      w.mergeReverted.push(r.entry);
    }
    // The span the pick added — the pair the carry's revert was bounded by —
    // and not the entry's own span base, because a span row's two shas always
    // bound the same range. The entry stays pending; its retry carries the
    // prior-attempt block the carry wrote.
    return {
      ...(staked === undefined ? {} : { staked }),
      shipped: [],
      outcome: {
        entryTag: r.entry.tag,
        outcome: carried.fate,
        footprint: carried.touchedPaths,
        baseSha: carried.landedOnSha,
        headSha: carried.mergedSha,
      },
    };
  }

  const verdict = await consultShipped(
    w,
    r,
    r.spanBase,
    carried,
    w.mergeGateResults.slice(entryMergeGateResultsStart),
  );
  return {
    ...(staked === undefined ? {} : { staked }),
    outcome: verdict.outcome,
    shipped: verdict.shipped,
  };
}

/**
 * Ask the phase whether a span that landed on trunk and passed its gates
 * *shipped*, and answer with the row either way.
 *
 * Trunk holding the whole span leaves the pick nothing to add, and the entry is
 * merged all the same. `shipped` is asked exactly as for any other merge —
 * whether work already on trunk ships is the chain's reading, never the
 * engine's (spec/loop.md "Tip verify — one writer per branch, absorption at the
 * merge").
 *
 * Landing on trunk isn't shipping, and the engine does not decide which of the
 * two this is. It reports facts; the chain interprets (spec/pending.md "Ship
 * detection trusts the agent's own account"; .claude/rules/engine-boundary.md
 * "Told, not inferred"). Undeclared means shipped.
 *
 * One home for the consult, because a batched merge reaches it per span with
 * the batch's own gate rows and a serial merge reaches it with that span's
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*): which
 * rows the predicate reads is the caller's, and everything the consult then
 * does with a refusal — the warning, the prior-attempt record, the stage
 * failure — is the same either way.
 */
async function consultShipped(
  w: WaveMerge,
  r: EntryAttempt,
  /** The span's base, read where `committed` narrowed it ({@link BatchCandidate}). */
  spanBase: string,
  landed: { mergedSha: string; landedOnSha: string; touchedPaths: string[] },
  mergeGateResults: readonly ReportedGateResult[],
): Promise<{
  shipped: readonly PendingEntry[];
  outcome: TickVerdictMergeOutcome;
}> {
  const { leg, phase } = w.setup;
  // Everything this span may ship: the entry it was handed and that entry's
  // steps, which are the work of the same one session (spec/pending.md "Ship
  // detection trusts the agent's own account"). The entry leads, so the
  // resolution below answers in the queue's own order whatever order the
  // predicate named its tags in.
  const shippable = [r.entry, ...r.steps];
  let declared: readonly string[];
  // spec/chain.md "What a hook receives": a `shipped` the engine cannot read
  // is not an empty list. The outcome is the one the seam already has for a
  // predicate that declines — entry stays pending, commit stays on trunk,
  // merge bookkeeping below completes — but the verdict names what the hook
  // did, so a broken predicate never reads back as a deliberate park. Two
  // ways to be unreadable and one class: a throw, and a list the span cannot
  // ship ({@link unshippableTags}). Held apart only for the line an operator
  // reads, which says which of the two it was.
  let threw: string | undefined;
  try {
    declared =
      phase.shipped?.({
        entry: r.entry,
        steps: r.steps,
        mergedSha: landed.mergedSha,
        baseSha: spanBase,
        touchedPaths: landed.touchedPaths,
        gateResults: [...r.gateResults, ...mergeGateResults],
        worktreePath: r.worktreePath,
        repoRoot: leg.repoRoot,
      }) ?? shippable.map((e) => e.tag);
  } catch (err) {
    threw = thrownMessage(err);
    declared = [];
  }
  const unshippable =
    threw === undefined ? unshippableTags(r, declared) : undefined;
  const broke = threw ?? unshippable;
  // The entries behind the tags, filtered out of the offered set rather than
  // looked up one by one: that dedupes a tag named twice and keeps the
  // queue's order, and a set the engine refused ships nothing at all.
  const shipped =
    broke === undefined
      ? shippable.filter((e) => declared.includes(e.tag))
      : [];
  if (shipped.length === 0) {
    leg.log.warn(
      `[flume] ${r.entry.tag}: cherry-picked ${landed.mergedSha.slice(0, 8)} but ${phase.name}.shipped ${
        threw !== undefined
          ? `threw: ${threw}`
          : unshippable !== undefined
            ? `answered with a list this span cannot ship — ${unshippable}`
            : "named no tag"
      } — commit stays on trunk, entry stays pending`,
    );
    // spec/loop.md "Prior-outcome feedback to the retrying tick": the
    // entry stays queued, so its next tick is a retry and gets the same
    // channel every other queue-unchanged outcome gets. Without it the
    // fact lives only in the verdict log, which a chain can only reach
    // by re-deriving "was the last attempt declined" from history —
    // exactly the rebuild `TickContext.priorAttempts` exists to spare
    // it. Cleared by the existing shipped-entry sweep the ledger rewrite
    // runs the moment a later attempt ships clean. `broke` rides it for
    // the same reason it rides the merge outcome below: the disk record is
    // what the *next* process reads, and a broken predicate collapsing into
    // "the chain parked this" is a wall the retry would invent.
    await leg.attempts.write(
      priorAttemptRef(phase, r.entry),
      buildNotShipped(landed.mergedSha, landed.touchedPaths, broke),
    );
    // A broken hook is a stage failure; an empty list is not. The run's accounting
    // reads this list, never the `not-shipped` outcomes — the outcome
    // is the entry's fate, and re-filtering it for the throws would rebuild
    // beside the engine the split the engine already made
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*). Blamed by `blamedOn` unconditionally: the consult
    // only happens for a span this wave carried, so the entry is always
    // there, and a hook broken for one entry is exactly what the per-entry
    // leg exists to isolate.
    if (broke !== undefined)
      w.shipFailures.push({
        ...blamedOn(r.entry),
        ...stageFailureFacts(broke),
      });
    return {
      shipped: [],
      outcome: {
        entryTag: r.entry.tag,
        outcome: "not-shipped",
        baseSha: landed.landedOnSha,
        headSha: landed.mergedSha,
        ...(broke === undefined ? {} : { threw: broke }),
      },
    };
  }
  // `merged` whether the list was the whole span or part of it: the commit
  // landed and the chain did not decline it. Which tags left is the shipped
  // set this answers with, and an entry whose own tag is not among them reads
  // `shipped: false` beside this `merged` — the pair that tells a partial
  // ship from a park (`FanoutEntryOutcome`, `src/Phase.ts`).
  return {
    shipped,
    outcome: {
      entryTag: r.entry.tag,
      outcome: "merged",
      baseSha: landed.landedOnSha,
      headSha: landed.mergedSha,
    },
  };
}

/**
 * Why a `shipped` list is one the engine cannot read, or `undefined` for one
 * this span can ship. Two refusals, both over what the rewrite behind this
 * consult would otherwise *delete* (`commitPendingUpdate`,
 * `src/pendingLedger.ts`) — the one thing the engine's own mechanics consume
 * the list for (`.claude/rules/engine-boundary.md`, *Capability vs
 * convention*):
 *
 * - a tag the span was never offered, which names an entry some other
 *   session is carrying, or none at all;
 * - the entry's own tag without every one of its steps, which would remove
 *   the file each remaining step's `parent` names and leave a queue no later
 *   read can parse (`spec/pending.md`, *The queue is a forest*).
 *
 * Refused rather than narrowed or completed: a list the engine quietly fixed
 * up would ship a tag the chain did not name, and a queue written past this
 * point is one an operator repairs by hand
 * (`.claude/rules/engineering.md`, *Loud or nothing*). The engine's own
 * undeclared default names the entry and every step, so nothing a chain gets
 * for free lands here.
 */
function unshippableTags(
  r: EntryAttempt,
  declared: readonly string[],
): string | undefined {
  const offered = new Set([r.entry.tag, ...r.steps.map((s) => s.tag)]);
  const foreign = declared.filter((tag) => !offered.has(tag));
  if (foreign.length > 0) {
    return `shipped named ${foreign.join(", ")}, which is neither ${r.entry.tag} nor a step of it`;
  }
  if (!declared.includes(r.entry.tag)) return undefined;
  const left = r.steps.filter((s) => !declared.includes(s.tag));
  return left.length === 0
    ? undefined
    : `shipped named ${r.entry.tag} without its step(s) ${left
        .map((s) => s.tag)
        .join(", ")}, which the queue cannot hold: a step's parent names an entry in the same queue`;
}

/**
 * Close the stage once every attempt has been carried: the facts the wave leg
 * folds into its `TickResult` and its verdict.
 *
 * Nothing here touches trunk. Each pick landed its own ledger commit and
 * retired its own merge marker inside its own ship-lock hold
 * ({@link drainWaiting}), so what is left of the stage is the fold over what
 * those picks observed.
 */
export function closeWaveMerge(w: WaveMerge): WaveMergeResult {
  // A span offered and never carried is a commit this wave dropped with nothing
  // on any surface saying so — the one failure the drive's shape makes
  // impossible and no type holds: one drain is chained per offered attempt and
  // each drain carries at least the front of the queue, so the queue is empty by
  // the last of them (`drainWaiting`). Refused rather than closed over
  // (`.claude/rules/engineering.md`, *Loud or nothing*); a wave that walled
  // never reaches here, and its uncarried spans are rowed instead
  // ({@link abandonWaiting}).
  if (w.waiting.length > 0) {
    throw new Error(
      `${w.setup.phase.name}: ${w.waiting.length} finished span(s) were ` +
        `waiting on the ship lock when the merge stage closed ` +
        `(${w.waiting.map((s) => s.attempt.entry.tag).join(", ")}): every ` +
        `offered span is carried or rowed, so this is a merge drive that lost ` +
        `one`,
    );
  }
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
    ...(w.gatedTip ? { gatedTip: w.gatedTip } : {}),
    mergeOutcomes: w.mergeOutcomes,
    mergeFailures: w.mergeFailures,
    gateFailures: w.gateFailures,
    shipFailures: w.shipFailures,
    tipMoved: w.tipMoved,
    declined: w.declined,
    ...(w.checkpoint.sha ? { bystanderCheckpointSha: w.checkpoint.sha } : {}),
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
 * ({@link waveWallThrow}), which is the wave leg's own throw site
 * (`src/waveTick.ts`).
 *
 * Returns the exit the rewrite reported, so the caller's own tip read turns
 * on the rewrite's statement rather than on a second reading of the ref
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*). `undefined` is no rewrite at all: this pick shipped nothing
 * and recorded no footprint, so there was nothing for one to write.
 */
async function commitAttemptLedger(
  w: WaveMerge,
  shippedNow: readonly PendingEntry[],
  outcomesNow: readonly TickVerdictMergeOutcome[],
): Promise<PendingRewriteResult["exit"] | undefined> {
  const { leg, phase, partitionIgnore } = w.setup;
  // `commitPendingUpdate` derives the footprints straight off these merge
  // outcomes, the same records this wave's TickVerdict carries — no separate
  // observed-files bookkeeping here.
  const footprintTags = outcomesNow.flatMap((m) =>
    m.entryTag && m.footprint && m.footprint.length > 0 ? [m.entryTag] : [],
  );
  if (shippedNow.length === 0 && footprintTags.length === 0) return undefined;
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
  // refusing rather than proceeding, and they stand on disk until the sweep
  // the next `flume loop` start runs (`sweepStaleWorktrees`,
  // `src/worktrees.ts`) takes the directory and the branch it was cut on — a
  // prune, which drops the metadata of a directory already gone, takes
  // neither.
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
    // here (`waveWallThrow`): a slot still running can fold a decline or
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
    return update.exit;
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
  return update.exit;
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
 * The error a walled wave leaves with, at the point every slot it opened has
 * finished: this wave's facts as they *settled*, carried on the throw for
 * `tick()` to report.
 *
 * Every wall leaves carried, never its cause alone. A marker whose stake would
 * not write, a prior-attempt record the store refused, a `revParse` the disk
 * failed, an agent that exploded: each of them leaves behind what a refused
 * rewrite leaves — the picks before it cherry-picked and gated onto trunk, a
 * usage row per agent that ran, the merge rows and gate rows the stage folded
 * — and a bare re-throw discards all of it
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*).
 *
 * One selection over both holders the wave leg fills ({@link WaveWallHeld}),
 * never a throw site per holder: a wave can hit a slot leg's throw and a
 * refusing rewrite in the same breath — a teardown that failed beside a
 * sibling pick whose rewrite read an unparseable queue — and a throw site per
 * holder lets whichever one the leg tested first decide the class, which is
 * how a {@link WaveMerge.refusal} this stage had recorded came to reach no
 * surface at all. The ranking lives in {@link waveWall} instead.
 *
 * Called from the wave leg's own throw site rather than from the pick or the
 * slot that threw (`src/waveTick.ts`): the wall stops the wave carrying any
 * further span, but the siblings already running still settle behind it, and a
 * decline folded or a render refusal raised in that window is a fact of this
 * tick. A verdict built at the pick names whichever of them happened to have
 * landed first (spec/loop.md "The tick verdict — one facts artifact").
 */
export async function waveWallThrow(
  w: WaveMerge,
  held: WaveWallHeld,
): Promise<WaveCarriedThrow> {
  const [classed, ...rest] = waveWall(w, held);
  const { cause, ledger, event } = classed;
  const unclassedWalls = rest.map((wall) => ({
    event: wall.event,
    ...stageFailureFacts(thrownMessage(wall.cause)),
  }));
  // Said once, here, where the ranking is: the classed wall reaches the
  // operator on the verdict's own summary line and nothing prints the rest,
  // so a wave that walled twice read as a wave that walled once.
  for (const wall of unclassedWalls)
    w.setup.leg.log.warn(
      `[flume] ${w.setup.phase.name}: ${wall.event} beside the wall this wave reports (${wall.message}); both stand, and the verdict names both`,
    );
  const verdict = await settledWaveVerdict(w, cause, event, unclassedWalls);
  return ledger
    ? new WaveLedgerRefusal(cause, verdict)
    : new WaveCarriedThrow(cause, verdict);
}

/**
 * The two holders a wave leg fills on its way to leaving by a throw: the
 * first throw out of the merge stage, and the first out of a slot's own leg
 * (`runFanout`, `src/waveTick.ts`). One, the other, or both — a wave walls on
 * whichever it hits first and keeps running until every slot it opened has
 * settled, so the second wall is a window's worth of work away, not a
 * contradiction.
 */
interface WaveWallHeld {
  readonly mergeError: unknown;
  readonly slotError: unknown;
}

/**
 * Every wall a wave held, ranked, the one it reports first: for each, the
 * cause, whether that cause refused a pending ledger, and what happened in
 * the operator's words. The head decides the carry's class and the one
 * summary line the verdict names; the rest ride the verdict beside it as
 * facts ({@link UnclassedWall}), because a wave keeps running after its first
 * wall and the loser is a wall an operator still has to repair
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * Three arms, ranked, because a wave can hold more than one wall at once and
 * only one class reaches `tick()`:
 *
 * - A rewrite the merge stage recorded as refused ({@link WaveMerge.refusal})
 *   outranks either holder. It is the wall an operator repairs at the queue
 *   rather than at the tick, and the only one whose repair a walled wave can
 *   state — so a slot leg that threw beside it does not take the class off it.
 *   The refusal is read for its own cause too: the holder beside it is that
 *   same throw re-caught a layer out, and the class comes from the call that
 *   took the refusal rather than read back off a cause
 *   (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 * - A slot leg's throw next. A freed slot's decide-read over a queue this
 *   phase's fence does not admit refuses with a `PendingParseFailure`
 *   (`readPendingForDecision`, `src/pendingLedger.ts`) and is a ledger
 *   refusal; an agent that exploded, a hook that threw, a read of the tree
 *   that would not resolve refused no ledger and takes the base carry.
 * - The merge stage's own throw last: with no refusal recorded it is a marker
 *   the disk would not take, a record the store refused, a `revParse` that
 *   failed. Reported as no ledger refusal at all rather than assigned one
 *   this site would have to invent.
 *
 * Deduplicated by cause identity, which is why the recorded refusal above can
 * be listed beside the merge holder without double-reporting: the refusal
 * re-throws its cause, so the merge holder *is* that same object one layer
 * out, and one throw is one wall. Identity rather than a message comparison —
 * the same object is a fact, two errors reading alike is a guess
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * Non-empty over the holders the leg calls it with, which is at least one
 * (`waveThrows`, `src/waveTick.ts`): the merge stage's arm is last because a
 * wave holding neither holder never reaches here.
 */
function waveWall(
  w: WaveMerge,
  held: WaveWallHeld,
): readonly [WaveWallRank, ...WaveWallRank[]] {
  const refusal = w.refusal;
  const ranked: WaveWallRank[] = [];
  if (refusal !== undefined)
    ranked.push({
      cause: refusal.cause,
      ledger: true,
      event: "pending-ledger rewrite refused",
    });
  if (held.slotError !== undefined) {
    const ledger = held.slotError instanceof PendingParseFailure;
    ranked.push({
      cause: held.slotError,
      ledger,
      event: ledger ? "mid-wave queue re-read refused" : "a slot leg threw",
    });
  }
  if (held.mergeError !== undefined)
    ranked.push(mergeStageWall(held.mergeError));
  // The default is the merge arm this ranking's last rung already is, which
  // is how the selection stays total without a refusal it could never take:
  // a wave reaching here holds at least one of the three, so the list is
  // non-empty, and the type says so for the caller that reads the head.
  const [classed = mergeStageWall(held.mergeError), ...rest] = ranked;
  const seen: unknown[] = [classed.cause];
  const unclassed: WaveWallRank[] = [];
  for (const wall of rest) {
    if (seen.some((cause) => Object.is(cause, wall.cause))) continue;
    seen.push(wall.cause);
    unclassed.push(wall);
  }
  return [classed, ...unclassed];
}

/** The ranking's last rung, and its totality default ({@link waveWall}). */
function mergeStageWall(cause: unknown): WaveWallRank {
  return { cause, ledger: false, event: "the merge stage threw" };
}

/**
 * One wall as the ranking states it: the cause, whether that cause refused a
 * pending ledger, and what happened in the operator's words. The head of the
 * ranking spends all three — the carry's class, its `ledgerRefusal`, and the
 * verdict's summary line — and every wall behind it spends `event` alone,
 * on {@link UnclassedWall}.
 */
interface WaveWallRank {
  readonly cause: unknown;
  readonly ledger: boolean;
  readonly event: WaveWallEvent;
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
 * the verdict carries. It arrives through {@link waveWallThrow}, naming the
 * wall that outranked the others — a rewrite behind a pick that refused, the
 * merge stage throwing outside one, a slot leg that threw ({@link waveWall})
 * — because an operator reading the verdict has a different repair for each.
 *
 * `why` reads the cause through `thrownMessage` (`src/thrown.ts`) — the same
 * fold {@link WaveCarriedThrow}'s own message takes, so the summary and the
 * error carrying it cannot describe one refusal differently.
 *
 * `unclassedWalls` is the rest of what the same ranking held — the walls that
 * reach no class, no exit arm and no summary line, and would otherwise reach
 * no surface at all ({@link UnclassedWall}).
 */
async function settledWaveVerdict(
  w: WaveMerge,
  cause: unknown,
  event: WaveWallEvent,
  unclassedWalls: readonly UnclassedWall[],
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
  const why = thrownMessage(cause);
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
    bystanderCheckpointSha: w.checkpoint.sha,
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
    unclassedWalls,
    clearedPriorAttempts,
    // The picks this wave landed before the wall are on trunk and gated, so
    // the tip the last of them left is reported exactly as a completing
    // wave's is — held on the stage from the hold that read it, never
    // re-derived from the tip below, which the wall may have moved past.
    gatedTip: w.gatedTip,
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
