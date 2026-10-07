/**
 * The span carry: a finished span's whole passage onto trunk — the refusal
 * that may decline it before anything is staked, the checkpoint over the
 * operator's uncommitted work, the cherry-pick, the `afterMerge` gates over
 * the merged tip, and the revert that may take the span back off again.
 *
 * One home for the sequence both legs that carry a span run — a fanout wave's
 * per-entry merge (`src/waveMerge.ts`) and a singleton phase's own
 * (`src/singletonTick.ts`) — over a span whose entry is optional, which is the
 * job neither of those files is named for (`.claude/rules/engineering.md`, *A
 * module is one job*). A span is a base and a head on a worktree branch; that
 * a fanout wave has an entry to name it by and a singleton has only its phase
 * changes what the two legs *say* about the carry, never what the carry does.
 *
 * Two entry points over the same three steps, because a wave's merge may carry
 * several spans at once (spec/worktrees.md, *Batched merges*):
 * {@link carryMergeSpan} picks one range and gates it on its own, and
 * {@link carryMergeBatch} picks N in order and gates the result once. The pick
 * ({@link pickSpanRange}), the claim refusal ({@link foreignTipRefusal}) and
 * the gate loop ({@link gateMergedTip}) are shared between them, so a batch is
 * the same passage at a width rather than a second spelling of it.
 *
 * So what is not here is what the two do not share: the merge marker a wave
 * stakes before its pick, the blame half of every failure recorded
 * (`StageFailureEntry`, `src/tickVerdict.ts`), the `shipped` consult and the
 * ledger rewrite that retire a tag, and the verdict rows each leg writes. This
 * module runs the git sequence and answers with the facts of it
 * ({@link SpanCarried}); the leg spells what those facts mean, in its own
 * words ({@link SpanNarration}) and on its own surfaces.
 *
 * Every call below touches the primary checkout, so a caller reaches it
 * holding the ship lock (spec/loop.md "The ship lock and the worktree lock —
 * sibling ticks take turns at git"). The lock stays the caller's rather than
 * being taken here: a wave's ledger rewrite lands inside the same hold as the
 * pick that earned it, one `await` past this return.
 */

import { batchGateContext } from "./gateBatch.js";
import type {
  BatchGateContext,
  GateBatchSpan,
  GateContext,
  GateSite,
} from "./Gate.js";
import { runGate } from "./gateRun.js";
import * as git from "./git.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Phase } from "./Phase.js";
import { buildGateRevert, type PriorAttemptRef } from "./priorAttempts.js";
import { thrownMessage } from "./thrown.js";
import type { TickLegContext } from "./tickLeg.js";
import { checkMergedTipUnmoved, liveForeignClaimPid } from "./tipVerify.js";
import {
  gateFailureSignature,
  reportedGateRow,
  stageFailureFacts,
  unrevertableMergeFailure,
  type ReportedGateResult,
} from "./tickVerdict.js";

/**
 * The two facts a stage failure reports, as {@link carryMergeSpan} hands them
 * out: the message the wall raised and the key it is compared by
 * (`stageFailureFacts`, `src/tickVerdict.ts`). The blame half is the leg's —
 * a wave reads the gate's own attribution against the entry it carried, a
 * singleton has no entry to blame at all (`StageFailureEntry`,
 * `src/tickVerdict.ts`) — so these arrive unblamed and each leg spreads its
 * own verdict onto them.
 */
type StageFacts = {
  signature: string;
  message: string;
};

/**
 * The bystander checkpoint over whatever the operator has staged or unstaged
 * on the primary checkout, staked once per carrier right before its first pick
 * range (spec/loop.md "Crash equals stop") — a wave's whole batch of picks or
 * a singleton's one.
 *
 * Passed in and updated in place, because "once" is the caller's span, not the
 * carry's: a wave carries many spans and checkpoints before the first of them.
 * `attempted` is its own flag rather than a test of `sha`, so a checkout that
 * was clean at that moment — `checkpointBystanderState` answering `undefined`
 * — is never re-checkpointed on a later span of the same carrier.
 */
export interface BystanderCheckpoint {
  /** Whether this carrier has reached its checkpoint yet. */
  attempted: boolean;
  /** The checkpoint commit, when one was taken over a dirty checkout. */
  sha: string | undefined;
}

/**
 * The words one leg reports its carry in: one function per point the sequence
 * has something to say, each answering the whole log line — `[flume]` prefix
 * included. A wave names the entry whose span it is carrying and what a
 * refusal leaves pending; a singleton names the phase and the worktree branch
 * its commit stays on. Which of these is a warning and which is information is
 * the step's own fact, so the severity is {@link carryMergeSpan}'s and only
 * the words are the leg's.
 *
 * A record of functions rather than one line the carry composes from a label:
 * the two legs report to readers holding different questions, and a spelling
 * shared across them would be a third vocabulary neither leg speaks.
 */
type SpanNarration = {
  /** A live foreign tip claim refused the pick, by the pid holding it. */
  tipClaimed(pid: number): string;
  /** The pick hit a real conflict, with the words git raised. */
  pickFailed(message: string): string;
  /** The tip already held some of the span, in the order git stopped on them. */
  absorbed(shas: readonly string[]): string;
  /** An `afterMerge` gate turned red over the merged tip, by gate name. */
  gateFailed(gate: string): string;
  /**
   * The revert off trunk was refused; the commit stays there for the operator.
   *
   * One spelling of the refusal, because every leg's line names the two shas
   * itself, in git's short form: the bare words the wall raised. What a leg
   * *records* for the same refusal composes the full shas into the message
   * (`unrevertableMergeFailure`, `src/tickVerdict.ts`), and that composition
   * stays off the line — the row and the line correlate by sha, not by string.
   */
  revertRefused(facts: {
    /** The commit left standing on trunk. */
    mergedSha: string;
    /** The tip the refused reset would have returned trunk to. */
    landedOnSha: string;
    /** The words the refusal itself raised. */
    refusal: string;
  }): string;
  /**
   * The span is on trunk. `landedOnSha` equal to `mergedSha` is the whole span
   * absorbed, with no commit left to add.
   */
  merged(mergedSha: string, landedOnSha: string): string;
};

/** What a span that reached trunk landed as, whatever became of it after. */
type SpanLanded = {
  /** The trunk tip the pick produced. */
  mergedSha: string;
  /**
   * The trunk tip the span landed onto — where the writer that picked ahead of
   * it left trunk, and the lower end of the range {@link SpanLanded.touchedPaths}
   * is diffed over. Its own fact, never the span's base under another name:
   * trunk may have moved since the span branched.
   */
  landedOnSha: string;
  /** What the pick added to trunk, diffed over that range. */
  touchedPaths: string[];
};

/** A span whose `afterMerge` gate turned red, whatever became of the revert. */
type SpanRevert = SpanLanded & {
  /** The red gate's own stage failure, unblamed ({@link StageFacts}). */
  gateFailure: StageFacts;
  /**
   * The gate's attribution as it declared it (`ReportedGateResult.blamesSpan`,
   * `src/tickVerdict.ts`), reported so the leg's blame verdict reads the
   * declaration rather than inferring one. A gate that disowned the span
   * disowns the collision its revert then hit too: the revert only happened
   * because the gate refused.
   */
  blamesSpan: ReportedGateResult["blamesSpan"];
};

/**
 * What became of one span's carry. The fate names the `MergeOutcome` (`src/tickVerdict.ts`) the
 * leg rows it as, so the row reads its outcome from here rather than
 * respelling it; every other field is a fact of the passage, and what it means
 * for a queue, a verdict or a retry stays the leg's
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 */
type SpanCarried =
  /** A live foreign tip claim refused before the checkpoint or the pick: trunk holds nothing of this span. */
  | { fate: "tip-moved" }
  /** The pick hit a real conflict and was aborted: trunk holds nothing of this span either. */
  | {
      fate: "cherry-pick-conflict";
      /** The conflict's own stage failure, unblamed ({@link StageFacts}). */
      failure: StageFacts;
      /**
       * What the span would have added, captured off its own two commits
       * before the abort — best-effort, and absent when even that read failed.
       * Read by a leg whose rewrite keys footprints by tag
       * (`commitPendingUpdate`, `src/pendingLedger.ts`); a span with no entry
       * has no tag to key one under.
       */
      footprint?: string[];
    }
  /** The gate's commit is off trunk again and the span is the leg's to retry. */
  | (SpanRevert & { fate: "afterMerge-reverted" })
  /** The gate's commit could not be taken off trunk and stays there for the operator. */
  | (SpanRevert & {
      fate: "afterMerge-revert-refused";
      /** Why the revert was refused, unblamed ({@link StageFacts}). */
      failure: StageFacts;
    })
  /** The span is on trunk and its gates were green. */
  | (SpanLanded & { fate: "merged" });

/**
 * Carry one span onto trunk and answer with what became of it.
 *
 * The order is the whole of what this function is: refuse to a live foreign
 * claim before anything is staked, checkpoint the operator's work before the
 * first pick range, stake whatever the leg holds for the window between, pick
 * the range, gate the merged tip, and revert exactly the commits the pick added
 * when a gate turns red. Each step's reason is at the step, in the step's own
 * function — the three the batch carry below runs over N spans instead of one
 * ({@link carryMergeBatch}).
 */
export async function carryMergeSpan(carry: {
  /** The tick's leg: the primary checkout every call below runs in, its log, its record store, its tip claim. */
  leg: TickLegContext;
  /** The phase whose `afterMerge` gates judge the merged tip. */
  phase: Phase;
  /** The span's base — the tip its agent branched from, and the pick range's lower end. */
  base: string;
  /** The span's head — the last commit the agent left on its worktree branch. */
  head: string;
  /**
   * The entry this span carries, for the gates that read it
   * (`GateContext.entry`, `src/Gate.ts`) — absent on a singleton phase's span,
   * which has no entry at all.
   */
  entry?: PendingEntry;
  /**
   * That entry's steps, as the queue listing its slot pulled from held them
   * (`GateContext.steps`, `src/Gate.ts`). Stated by every leg that states an
   * {@link entry} — an entry no producer decomposed states the empty list —
   * and absent with it, so what reaches the gates is the leg's own account of
   * the session's assignment rather than a default invented here.
   */
  steps?: readonly PendingEntry[];
  /** Where a gate revert's prior-attempt record lands (`priorAttemptRef`, `src/priorAttempts.ts`). */
  ref: PriorAttemptRef;
  /** This carrier's {@link BystanderCheckpoint}, updated in place when this span is the one that takes it. */
  checkpoint: BystanderCheckpoint;
  /**
   * What the leg stakes in the window this carry opens between the checkpoint
   * and the pick — a wave's merge marker, which must be standing before the
   * first commit of the range lands and must *not* be standing for a span
   * refused ahead of it (spec/loop.md "Crash equals stop"). No leg has
   * anything to stake after the pick, so there is one window and it is here.
   */
  stake?: () => Promise<void>;
  /**
   * One `afterMerge` gate row and what it cost, handed over as the gate
   * returns rather than collected and answered at the end: a throw past this
   * point is a tick whose verdict still names every gate that ran
   * (spec/loop.md "The tick verdict — one facts artifact").
   */
  onGateRow: (row: ReportedGateResult, ms: number) => void;
  /** The words this leg reports the carry in ({@link SpanNarration}). */
  narrate: SpanNarration;
}): Promise<SpanCarried> {
  const { leg, phase, base, head, narrate } = carry;
  const repoRoot = leg.repoRoot;

  if (await foreignTipRefusal(leg, narrate.tipClaimed)) {
    // Refused ahead of the checkpoint and the pick, so trunk holds nothing of
    // this span and no bystander sha is staked. The leg's row is the whole
    // recovery handle: the span's commits outlive the branch teardown deletes
    // (`TickVerdictMergeOutcome`, `src/tickVerdict.ts`).
    return { fate: "tip-moved" };
  }
  const picked = await pickSpanRange({
    leg,
    base,
    head,
    checkpoint: carry.checkpoint,
    ...(carry.stake ? { stake: carry.stake } : {}),
    narrate,
  });
  if (picked.fate === "cherry-pick-conflict") return picked;
  const { mergedSha, landedOnSha, touchedPaths } = picked;
  const landed: SpanLanded = { mergedSha, landedOnSha, touchedPaths };
  const failingGate = await gateMergedTip(
    leg,
    phase,
    {
      ...gateSite(leg, phase),
      commitSha: mergedSha,
      touchedPaths,
      ...(carry.entry ? { entry: carry.entry } : {}),
      // The entry's steps beside it: one span is one session, and a session's
      // footprint is the entry's declaration and its steps' together
      // (`GateContext.steps`, `src/Gate.ts`).
      ...(carry.steps ? { steps: carry.steps } : {}),
      // The span's own base, not the tip it landed on: an `afterMerge` gate
      // reading trunk needs the tip its agent branched from to tell an input
      // the span ignored from one that landed after it started
      // (spec/chain.md "What a gate receives"). Siblings provisioned from the
      // same tip each carry their own value regardless.
      baseSha: base,
      // And the tip it landed onto beside it, which is what a cumulative
      // gate measuring trunk before and after this span reads as its
      // *before* (spec/chain.md "What a gate receives").
      landedOnSha,
    },
    carry.onGateRow,
  );
  if (failingGate) {
    leg.log.warn(narrate.gateFailed(failingGate.gate));
    // The first red gate condemns exactly the commits the pick added — they
    // are the only delta between the two shas below — so the revert drops
    // those and nothing else, and the span is the leg's to retry.
    //
    // The digest is captured while the merged sha is still reachable, over
    // that same pair. Not `mergedSha` alone: over a span trunk already held
    // whole the two are equal, and digesting the tip would hand the retry
    // whichever writer's commit is standing there as its own prior attempt
    // (spec/loop.md "Prior-outcome feedback to the retrying tick").
    const record = await buildGateRevert("afterMerge", failingGate, repoRoot, {
      base: landedOnSha,
      head: mergedSha,
    });
    await leg.attempts.write(carry.ref, record);
    const revert: SpanRevert = {
      ...landed,
      gateFailure: {
        signature: gateFailureSignature(failingGate),
        message: failingGate.message,
      },
      blamesSpan: failingGate.blamesSpan,
    };
    // Both refusals below end the span the same way: the commit stays on trunk
    // for the operator, and the leg reports it refused. One spelling, two
    // callers; each hands in the words its own wall raised for the line
    // ({@link SpanNarration.revertRefused}) and the stage failure it composed
    // from them for the record — `checkMergedTipUnmoved` (`src/tipVerify.ts`)
    // composing nothing beyond them and `unrevertableMergeFailure`
    // (`src/tickVerdict.ts`) both shas.
    const refused = (refusal: string, failure: StageFacts): SpanCarried => {
      leg.log.warn(narrate.revertRefused({ mergedSha, landedOnSha, refusal }));
      return { fate: "afterMerge-revert-refused", ...revert, failure };
    };
    // spec/loop.md "Tip verify — one writer per branch, absorption at the
    // merge", "dropping it must not take bystanders": the primary checkout may
    // hold an operator's uncommitted work, so this reset carries keep-semantics
    // — never --hard — and a textual collision refuses loudly rather than
    // silently discarding either writer's content. Caught here, not
    // propagated: an uncaught throw would take with it the facts this carry
    // has already produced, and for a wave the ledger rewrite that every
    // sibling already picked ahead of this span is waiting on.
    const foreignTip = await checkMergedTipUnmoved(
      repoRoot,
      landedOnSha,
      mergedSha,
    );
    if (foreignTip) return refused(foreignTip, stageFailureFacts(foreignTip));
    try {
      await git.resetKeepTo(repoRoot, landedOnSha);
    } catch (err) {
      if (!(err instanceof git.ResetKeepRefusedError)) throw err;
      return refused(
        err.message,
        unrevertableMergeFailure({
          refusal: err.message,
          mergedSha,
          preCherry: landedOnSha,
        }),
      );
    }
    return { fate: "afterMerge-reverted", ...revert };
  }
  leg.log.info(narrate.merged(mergedSha, landedOnSha));
  return { fate: "merged", ...landed };
}

/**
 * One span a batched merge is asked to carry: the range, the entry whose facts
 * the batch's gates read for it, the marker its leg stakes for it, and the
 * words its own pick is reported in.
 *
 * The narration is the single-span vocabulary minus the steps a batch does not
 * take per span — no gate runs over one span of a batch, so nothing reverts one
 * either, and `tipClaimed` is the batch's one refusal rather than N
 * ({@link BatchNarration}).
 */
interface BatchSpanInput {
  /** The span's base — the tip its agent branched from, and its pick range's lower end. */
  base: string;
  /** The span's head — the last commit the agent left on its worktree branch. */
  head: string;
  /** The entry this span carries, for the batch's gates to read as its own ({@link GateBatchSpan}). */
  entry?: PendingEntry;
  /** That entry's steps, on {@link carryMergeSpan}'s terms — stated with {@link entry} and absent with it. */
  steps?: readonly PendingEntry[];
  /** This span's stake window, on {@link carryMergeSpan}'s terms — before its own pick, never the batch's first. */
  stake?: () => Promise<void>;
  /** The words this span's own pick is reported in. */
  narrate: Pick<SpanNarration, "pickFailed" | "absorbed" | "merged">;
}

/**
 * The words a leg reports the batch's own steps in — the ones that hold over
 * every span it carried rather than over one of them, on
 * {@link SpanNarration}'s terms.
 */
type BatchNarration = {
  /** A live foreign tip claim refused the whole batch, by the pid holding it. */
  tipClaimed(pid: number): string;
  /** An `afterMerge` gate turned red over the batch's tip, by gate name. */
  gateFailed(gate: string): string;
  /** Trunk is back at the tip before the batch, and why it was taken there. */
  unwound(why: string): string;
};

/**
 * What became of a batched merge (spec/worktrees.md, *Batched merges*).
 *
 * `unwound` is the one fate a single-span carry has no equivalent of: trunk is
 * back at the tip the batch started from and the spans are the leg's to carry
 * one at a time, gated individually. It is not a verdict on any span — the
 * serial pass that follows is what produces those — so it carries only the
 * words the unwind happened in, for the leg's log and nothing else.
 */
type BatchCarried =
  /** A live foreign claim refused before the first pick: trunk holds nothing of any span. */
  | { fate: "tip-moved" }
  /** Red, or a conflict while picking: trunk is back at the tip before the batch. */
  | { fate: "unwound"; why: string }
  /** Every span is on trunk, picked in order, and the batch's gates were green. */
  | { fate: "merged"; landed: readonly SpanLanded[] };

/**
 * Carry a batch of spans onto trunk and answer with what became of all of them
 * (spec/worktrees.md, *Batched merges*): picked in order onto the tip, gated
 * **once** over the result, and taken back off to the tip before the batch when
 * a gate turns red or a pick conflicts.
 *
 * The three steps are {@link carryMergeSpan}'s own, over N spans instead of one:
 * the same foreign-claim refusal ahead of everything, the same pick per span,
 * the same gate loop — handed a {@link BatchGateContext} instead of a single
 * span's, which is the whole of what a gate declaring `batches: true` bought
 * (`mergeBatchWidth`, `src/gateBatch.ts`).
 *
 * What it does **not** do is decide anything per span. No `shipped` consult, no
 * prior-attempt record, no ledger commit: a green batch's spans each have their
 * own, and a red one's are re-carried individually by the leg, so a verdict
 * taken here would be a second, contradictory fate for the same span. The leg
 * reads `landed` for the green case and re-enters the single-span carry for the
 * unwound one (`src/waveMerge.ts`).
 *
 * **The unwind is loud or nothing.** `reset --keep` back to the tip before the
 * batch can be refused — a bystander's uncommitted work colliding with the
 * paths the batch touched, or a foreign commit landed on trunk since the last
 * pick — and on that refusal this throws rather than answering. The batch's
 * commits stay on trunk ungated, which is not a state any span's fate can
 * describe and not one a serial re-carry can be run over: the wave walls, its
 * merge markers stay standing for the next start to refuse over, and the
 * operator repairs the checkout (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
export async function carryMergeBatch(carry: {
  /** The tick's leg: the primary checkout every call below runs in, its log, its tip claim. */
  leg: TickLegContext;
  /** The phase whose `afterMerge` gates judge the batch's tip. */
  phase: Phase;
  /** The spans to pick, in the order they are to land. At least two — one span is {@link carryMergeSpan}. */
  spans: readonly BatchSpanInput[];
  /** This carrier's {@link BystanderCheckpoint}, taken before the batch's first pick range if it has not been already. */
  checkpoint: BystanderCheckpoint;
  /** One `afterMerge` gate row and what it cost, on {@link carryMergeSpan}'s terms. */
  onGateRow: (row: ReportedGateResult, ms: number) => void;
  /** The words this leg reports the batch's own steps in ({@link BatchNarration}). */
  narrate: BatchNarration;
}): Promise<BatchCarried> {
  const { leg, phase, spans, narrate } = carry;
  const repoRoot = leg.repoRoot;
  if (spans.length < 2) {
    throw new Error(
      `a batched merge of ${spans.length} span(s) is the single-span carry ` +
        `under another name: a batch withholds every per-span fact from its ` +
        `gates, so carrying one span through here would gate it over a ` +
        `context that names no entry`,
    );
  }
  if (await foreignTipRefusal(leg, narrate.tipClaimed)) {
    return { fate: "tip-moved" };
  }
  // The tip before the batch — where a red gate or a conflicting pick puts
  // trunk back. Read before the first pick and before the checkpoint the pick
  // takes, so it is the tip whatever writer ran ahead of this batch left.
  const batchBase = await git.revParse(repoRoot);
  const landed: SpanLanded[] = [];
  const gateSpans: GateBatchSpan[] = [];
  /**
   * Put trunk back at the tip before the batch. Nothing landed yet — the
   * batch's first pick conflicted — is the one case with nothing to take off,
   * and `revParse` would already equal `batchBase`; the guard is the empty
   * `landed`, so no reset runs over a tip no pick of this batch moved.
   */
  const unwind = async (why: string): Promise<BatchCarried> => {
    const last = landed[landed.length - 1];
    if (last !== undefined) {
      // The same guard the single-span revert takes, over the batch's whole
      // range: a foreign commit that landed while the gates ran is legal
      // history a reset to `batchBase` would discard (`checkMergedTipUnmoved`,
      // `src/tipVerify.ts`).
      const foreignTip = await checkMergedTipUnmoved(
        repoRoot,
        batchBase,
        last.mergedSha,
      );
      if (foreignTip) throw new Error(`${why}; ${foreignTip}`);
      await git.resetKeepTo(repoRoot, batchBase);
    }
    leg.log.warn(narrate.unwound(why));
    return { fate: "unwound", why };
  };
  for (const span of spans) {
    const picked = await pickSpanRange({
      leg,
      base: span.base,
      head: span.head,
      checkpoint: carry.checkpoint,
      ...(span.stake ? { stake: span.stake } : {}),
      narrate: span.narrate,
    });
    if (picked.fate === "cherry-pick-conflict") {
      // The conflicting pick is already aborted, so what is on trunk is the
      // spans before it. They go off too: a conflict is the batch's verdict,
      // and each span's own is the serial pass's to take.
      return unwind(`cherry-pick conflict: ${picked.failure.message}`);
    }
    landed.push(picked);
    gateSpans.push({
      ...(span.entry ? { entry: span.entry } : {}),
      ...(span.steps ? { steps: span.steps } : {}),
      commitSha: picked.mergedSha,
      baseSha: span.base,
      landedOnSha: picked.landedOnSha,
      touchedPaths: picked.touchedPaths,
    });
  }
  const failingGate = await gateMergedTip(
    leg,
    phase,
    // Every per-span fact on the span records, every batch-wide fact computed
    // from them (`batchGateContext`, `src/gateBatch.ts`) — never restated here.
    batchGateContext(gateSite(leg, phase), gateSpans),
    carry.onGateRow,
  );
  if (failingGate) {
    leg.log.warn(narrate.gateFailed(failingGate.gate));
    // No prior-attempt record and no gate failure reported for the batch's own
    // red: the serial pass below it re-runs these gates per span, and the
    // entry each of them blames is the one that pass condemns. A record
    // written here would name every span for a verdict one of them earned.
    return unwind(
      `afterMerge gate '${failingGate.gate}' failed over the batch: ${failingGate.message}`,
    );
  }
  for (const [i, span] of spans.entries()) {
    const l = landed[i]!;
    leg.log.info(span.narrate.merged(l.mergedSha, l.landedOnSha));
  }
  return { fate: "merged", landed };
}

/**
 * The live foreign tip claim both carries refuse to, before anything is staked
 * or picked (`liveForeignClaimPid`, `src/tipVerify.ts`).
 *
 * spec/loop.md "Tip verify — one writer per branch, absorption at the merge",
 * "Harness-driven commits carry no expected-tip bookkeeping — the claim
 * refuses, git arbitrates": no sha comparison against a recorded expectation. A
 * live claim on the ref is a concurrent engine instance and refuses exactly as
 * a moved tip used to — two engine instances interleaving picks on one ref is
 * the one interference no cherry-pick or conflict check can catch on its own
 * (`TickVerdict.tipMoved`, `src/tickVerdict.ts`). Absent one, whatever moved
 * trunk was not an engine, and the picks below land onto whatever tip is
 * current, with git's own conflict detection the only content arbiter left.
 *
 * One refusal per carry, never per span of a batch: the claim is a statement
 * about the ref, so asking it N times would read the same disk N times to
 * answer N identical questions.
 */
async function foreignTipRefusal(
  leg: TickLegContext,
  narrate: (pid: number) => string,
): Promise<boolean> {
  const foreignClaim = await liveForeignClaimPid(
    leg.repoRoot,
    leg.ownTipClaimPid,
  );
  if (foreignClaim === null) return false;
  leg.log.warn(narrate(foreignClaim));
  return true;
}

/** One span's pick, as {@link pickSpanRange} answers it. */
type SpanPicked =
  | {
      fate: "cherry-pick-conflict";
      /** The conflict's own stage failure, unblamed ({@link StageFacts}). */
      failure: StageFacts;
      /** What the span would have added, captured off its own two commits before the abort. */
      footprint?: string[];
    }
  | ({ fate: "picked" } & SpanLanded);

/**
 * Pick one span's range onto trunk: the checkpoint over the operator's
 * uncommitted work, the leg's stake window, the range itself, and the facts of
 * where it landed.
 *
 * One home for the step both carries take — once for a single span
 * ({@link carryMergeSpan}), once per span of a batch
 * ({@link carryMergeBatch}) — so what a pick absorbs, what it aborts and what
 * it reports has one spelling (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*). The foreign-claim refusal is **not** here: it is one
 * question per carry, asked by the caller ({@link foreignTipRefusal}).
 */
async function pickSpanRange(pick: {
  leg: TickLegContext;
  /** The span's base — the pick range's lower end. */
  base: string;
  /** The span's head — the pick range's upper end. */
  head: string;
  /** The carrier's checkpoint, taken here when this pick is the first of its carrier. */
  checkpoint: BystanderCheckpoint;
  /** The leg's stake window, between the checkpoint and the range. */
  stake?: () => Promise<void>;
  narrate: Pick<SpanNarration, "pickFailed" | "absorbed">;
}): Promise<SpanPicked> {
  const { leg, base, head, narrate } = pick;
  const repoRoot = leg.repoRoot;
  if (!pick.checkpoint.attempted) {
    // spec/loop.md "Crash equals stop": whatever the operator has staged or
    // unstaged on the primary checkout, recoverable from the tick verdict
    // alone even if the pick below conflicts and its `--abort` (guarded, but
    // still a reset) or a gate revert past it disturbs the checkout.
    pick.checkpoint.attempted = true;
    pick.checkpoint.sha = await git.checkpointBystanderState(repoRoot);
  }
  const landedOnSha = await git.revParse(repoRoot);
  // The stake window: whatever the leg needs standing if this pick dies
  // halfway through the range.
  await pick.stake?.();
  // The commits of this span trunk already held. A range pick absorbs those
  // rather than refusing over them (`git.cherryPickRange`), so only a real
  // conflict reaches the catch below. The whole range, in order, rather than
  // the newest commit alone: the attempt's own ancestry check already cleared
  // `base..head` as one completed span (spec/loop.md "The check is ancestry,
  // and N commits are completion"), and a one-commit span is the same call.
  let absorbed: readonly string[] = [];
  try {
    ({ absorbed } = await git.cherryPickRange(repoRoot, base, head));
  } catch (err) {
    const message = thrownMessage(err);
    leg.log.warn(narrate.pickFailed(message));
    let footprint: string[] | undefined;
    try {
      footprint = await git.diffNameOnly(repoRoot, base, head);
    } catch {
      // Footprint capture is best-effort; a retry without one partitions on
      // the entry's declared files as before.
    }
    // Abort the in-progress pick so the checkout is clean for the ticks after
    // this one. Without it, partially-applied changes block the next tick
    // (which cannot run `pnpm install` and the like against a dirty trunk) and
    // need a manual `git restore` to clear.
    await git.cherryPickAbort(repoRoot);
    return {
      fate: "cherry-pick-conflict",
      failure: stageFailureFacts(message),
      ...(footprint ? { footprint } : {}),
    };
  }
  const mergedSha = await git.revParse(repoRoot);
  if (absorbed.length > 0) {
    // Absorbed, never a conflict (spec/loop.md "Tip verify — one writer per
    // branch, absorption at the merge"). Said out loud, because a span
    // reaching trunk with fewer commits than it carried — or, when the two
    // shas below are equal, with none — is otherwise visible only as a merge
    // row whose two shas are equal.
    leg.log.info(narrate.absorbed(absorbed));
  }
  // Computed once and read by every gate the loop runs, then again as the
  // footprint of a revert — the same dedup the afterCommit loop does
  // (`runAfterCommitGates`, `src/tickAttempt.ts`). Diffed as a range rather
  // than read off `mergedSha`'s own single-commit show, so an earlier commit
  // of the span is not missed (spec/loop.md "The check is ancestry, and N
  // commits are completion").
  const touchedPaths = await git.diffNameOnly(repoRoot, landedOnSha, mergedSha);
  return { fate: "picked", mergedSha, landedOnSha, touchedPaths };
}

/**
 * Run the phase's `afterMerge` gates over whatever the merge put on trunk,
 * stopping at the first red and answering with its row.
 *
 * One loop for both carries: a single span's context and a batch's differ only
 * in what they say about the spans ({@link GateContext} against
 * {@link BatchGateContext}), and which of the two a gate may be handed is
 * `runGate`'s to keep (`src/gateRun.ts`), so neither carry spells the loop or
 * the refusal for itself.
 */
async function gateMergedTip(
  leg: TickLegContext,
  phase: Phase,
  ctx: GateContext | BatchGateContext,
  onGateRow: (row: ReportedGateResult, ms: number) => void,
): Promise<ReportedGateResult | undefined> {
  for (const gate of phase.gates) {
    if (gate.when !== "afterMerge") continue;
    const { result: gr, ms } = await runGate(gate, ctx, leg.gateScope);
    const row = reportedGateRow(gate.name, gr);
    onGateRow(row, ms);
    if (!gr.ok) return row;
  }
  return undefined;
}

/**
 * Where an `afterMerge` gate is running, for either carry: the trunk, this
 * tick's state-root facts and the phase's name — the half of a gate's input
 * that holds however many spans the merge carried ({@link GateSite}), composed
 * once rather than at each of the two sites that add the span facts to it.
 */
function gateSite(leg: TickLegContext, phase: Phase): GateSite {
  return {
    cwd: leg.repoRoot,
    repoRoot: leg.repoRoot,
    flumeDir: leg.flumeDir,
    stateRootRel: leg.stateRootRel,
    pendingDir: leg.pendingDir,
    configDir: leg.configDir,
    phaseName: phase.name,
    log: (l) => leg.log.info(l),
  };
}
