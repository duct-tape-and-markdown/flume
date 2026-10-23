/**
 * The span carry: a finished span's whole passage onto trunk — the refusal
 * that may decline it before any candidate is built, the candidate the span
 * is cherry-picked onto, the `afterMerge` gates that judge that candidate,
 * and the one fast-forward that moves trunk to it.
 *
 * **Trunk only ever moves forward** (spec/worktrees.md, *Per-entry
 * `afterMerge` revert isolation*). Nothing here picks onto the checkout an
 * operator, a CI trigger or a sibling worktree is reading — one span or a
 * batch of them, every pick lands in a tree of its own at the current tip, the
 * gates rule there, the leg lands whatever ships it there, and trunk
 * fast-forwards to the result or never names it at all. Every exit short of
 * that move discards one directory and leaves trunk exactly as it was, so no
 * reader of the branch can hold history trunk later drops.
 *
 * So the engine's one write to the shared checkout is that fast-forward, which
 * updates only the paths that differ and refuses, moving nothing, when an
 * uncommitted change collides (spec/loop.md, *Crash equals stop*). There is no
 * reset here, no abort and no checkpoint of an operator's staged work: no step
 * of either carry reaches far enough into their tree to owe one.
 *
 * One home for the sequence both legs that carry a span run — a fanout wave's
 * per-entry merge (`src/waveMerge.ts`) and a singleton phase's own
 * (`src/singletonTick.ts`) — over a span whose entry is optional, which is the
 * job neither of those files is named for (`.claude/rules/engineering.md`, *A
 * module is one job*). A span is a base and a head on a worktree branch; that
 * a fanout wave has an entry to name it by and a singleton has only its phase
 * changes what the two legs *say* about the carry, never what the carry does.
 *
 * Two entry points over the same steps, because a wave's merge may carry
 * several spans at once (spec/worktrees.md, *Batched merges*):
 * {@link carryMergeSpan} picks one range onto a candidate and gates it there,
 * and {@link carryMergeBatch} picks N in order onto one candidate and gates
 * that once. The claim refusal ({@link foreignTipRefusal}), the candidate
 * frame ({@link withProvisionedCandidate}), the pick ({@link pickSpanRange}),
 * the gate loop ({@link gateMergedTip}) and the fast-forward
 * ({@link fastForwardTrunk}) are shared between them, so a batch is the same
 * passage at a width rather than a second spelling of it.
 *
 * So what is not here is what the two do not share: the blame half of every
 * failure recorded (`StageFailureEntry`, `src/tickVerdict.ts`), the `shipped`
 * consult and the ledger rewrite that retire a tag — handed in as the leg's
 * own landing step ({@link carryMergeSpan}'s `land`), so the sequence calls
 * them where they belong without spelling either — and the verdict rows each
 * leg writes. This module runs the git sequence and answers with the facts of
 * it ({@link SpanCarried}); the leg spells what those facts mean, in its own
 * words ({@link SpanNarration}) and on its own surfaces.
 *
 * And every step either carry takes declares how far its own failure reaches
 * ({@link MergeWallScope}): a candidate that would not provision, a pick that
 * would not read, a record the store refused are one span's, while the tip
 * read, the claim on the ref and the fast-forward are trunk's. A leg reads
 * that scope off the wall ({@link readMergeWall}) and ends one span or stops
 * carrying, rather than treating every throw out of the stage as the whole
 * wave's (spec/worktrees.md, *Per-entry `afterMerge` revert isolation*).
 *
 * Both move the branch the primary checkout is on, so a caller reaches them
 * holding the ship lock (spec/loop.md "The ship lock and the worktree lock —
 * sibling ticks take turns at git"). The lock stays the caller's rather than
 * being taken here: building the candidate, the gates over it and the
 * fast-forward are one hold, and what the leg lands on a green candidate runs
 * inside it too.
 */

import { batchGateContext } from "./gateBatch.js";
import type {
  BatchGateContext,
  GateAssignment,
  GateBatchSpan,
  GateContext,
  GateSite,
} from "./Gate.js";
import { runGate } from "./gateRun.js";
import * as git from "./git.js";
import type { Phase } from "./Phase.js";
import { rebaseOntoTree } from "./paths.js";
import { buildGateRevert, type PriorAttemptRef } from "./priorAttempts.js";
import { thrownMessage } from "./thrown.js";
import type { TickLegContext } from "./tickLeg.js";
import { liveForeignClaimPid } from "./tipVerify.js";
import {
  gateFailureSignature,
  reportedGateRow,
  stageFailureFacts,
  type ReportedGateResult,
} from "./tickVerdict.js";
import { withMergeCandidate } from "./worktrees.js";

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
 * How far a merge-stage wall reaches, declared at the step that raises it.
 *
 * A step of the carry can fail over one span's own material — the candidate
 * tree it was provisioned, the pick onto it, the record its revert owes — or
 * over trunk's: the ref, the tip read, the queue the rewrite commits. The two
 * cost different things, and only the second is a reason to stop carrying the
 * siblings whose agents already finished (spec/worktrees.md, *Per-entry
 * `afterMerge` revert isolation*). A gate already declares exactly this
 * (spec/chain.md, *What a gate returns*); every other wall the stage can raise
 * declares it here.
 *
 * - `"span"` — this span's passage ends and nothing else is implicated. The
 *   leg reports it as that span's failed merge and goes on to the next.
 * - `"trunk"` — what the step was mid-way through is shared, so no further
 *   span can be carried and the leg walls.
 */
type MergeWallScope = "span" | "trunk";

/**
 * A wall one step of the carry raised, carrying the scope that step declared
 * ({@link MergeWallScope}).
 *
 * Its message is the cause's own, unprefixed, so a leg reporting it reports
 * what failed rather than this wrapper; `step` is the phrase the leg names the
 * site in, and `cause` is the thing itself — the one a trunk-scoped wall
 * travels on past the stage, since what reads a refusal downstream reads its
 * class and not ours ({@link readMergeWall}).
 *
 * Raised by {@link declareMergeWall} at every step of the carry, and directly
 * wherever a site states its scope by construction rather than by wrapping a
 * call it makes.
 */
class MergeWall extends Error {
  readonly scope: MergeWallScope;
  readonly step: string;
  constructor(scope: MergeWallScope, step: string, cause: unknown) {
    super(thrownMessage(cause), { cause });
    this.name = "MergeWall";
    this.scope = scope;
    this.step = step;
  }
}

/**
 * Run one step of a carry, declaring the scope of whatever it raises.
 *
 * Exported for the legs: what a leg lands on a green candidate is its own step
 * ({@link carryMergeSpan}'s `land`), so the scope of a throw out of it is the
 * leg's to state at its own site rather than this module's to guess.
 *
 * A wall already declared deeper passes through untouched: the innermost step
 * is the one that knows what it was doing, so an outer frame may wrap a whole
 * sub-sequence without overriding a scope stated inside it. That is what makes
 * the declaration total at the cost of one wrapper per frame rather than one
 * per call.
 */
export async function declareMergeWall<T>(
  scope: MergeWallScope,
  /** The phrase a leg names this site in, on {@link MergeWall.step}'s terms. */
  step: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MergeWall) throw err;
    throw new MergeWall(scope, step, err);
  }
}

/**
 * Read what a throw out of a carry declared, for the leg that has to decide
 * between ending one span and walling.
 *
 * An undeclared throw reads as trunk's. Not an inference about the cause: it
 * is the conservative reading of a step that stated nothing, and it is exactly
 * the behavior every merge-stage throw had before any of them declared
 * (`.claude/rules/engineering.md`, *Loud or nothing*). A step whose scope is
 * really one span's says so, and the suite is what proves the ones that matter
 * do.
 *
 * `cause` is what a leg re-throws rather than the wall itself, so nothing past
 * the merge stage branches on this class — a `PendingParseFailure`
 * (`src/PendingSchema.ts`) stays one, and the wave's own carry classes it as
 * it always did.
 */
export function readMergeWall(err: unknown): {
  scope: MergeWallScope;
  step: string;
  message: string;
  cause: unknown;
} {
  if (err instanceof MergeWall)
    return {
      scope: err.scope,
      step: err.step,
      message: err.message,
      cause: err.cause,
    };
  return {
    scope: "trunk",
    step: "the merge stage",
    message: thrownMessage(err),
    cause: err,
  };
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
  /** An `afterMerge` gate turned red over the candidate, by gate name. */
  gateFailed(gate: string): string;
  /**
   * Trunk declined the fast-forward to the judged candidate, so the candidate
   * is discarded and nothing of the span reached trunk.
   *
   * One spelling of the refusal, because every leg's line names the two shas
   * itself, in git's short form: the bare words git raised and nothing
   * composed around them. The candidate's sha is on the line so an operator
   * who wants the work can reach it before the sweep does — it is unreachable
   * from any ref the moment this returns.
   */
  fastForwardRefused(facts: {
    /** The candidate trunk declined to move to. */
    candidateSha: string;
    /** The tip the candidate was cut at, and the tip trunk stays at. */
    landedOnSha: string;
    /** The words the refusal itself raised. */
    refusal: string;
    /**
     * The tip trunk now stands at, present exactly when the carry is about to
     * be made again onto it ({@link MOVED_TIP_ABSORPTIONS}) — a foreign commit
     * landed under the candidate and this refusal is not the span's fate.
     * Absent when it is: trunk never moved, or the absorption is spent, and
     * the span is the leg's to report unshipped. Handed over rather than left
     * for the leg to guess, so a line promising a retry is only written where
     * one follows.
     */
    carriedAgainOnto?: string;
  }): string;
  /**
   * The span is on trunk. `landedOnSha` equal to `mergedSha` is the whole span
   * absorbed, with no commit left to add.
   */
  merged(mergedSha: string, landedOnSha: string): string;
};

/** What a span the pick landed on a candidate landed as, whatever became of it after. */
type SpanLanded = {
  /** The candidate tip the pick produced — a commit on trunk only once the fast-forward takes. */
  mergedSha: string;
  /**
   * The trunk tip the span landed onto — where the writer that picked ahead of
   * it left trunk, the tip the candidate was cut at, and the lower end of the
   * range {@link SpanLanded.touchedPaths} is diffed over. Its own fact, never
   * the span's base under another name: trunk may have moved since the span
   * branched.
   */
  landedOnSha: string;
  /** What the pick added, diffed over that range. */
  touchedPaths: string[];
};

/** A span whose `afterMerge` gate turned red over its candidate. */
type SpanRevert = SpanLanded & {
  /** The red gate's own stage failure, unblamed ({@link StageFacts}). */
  gateFailure: StageFacts;
  /**
   * The gate's attribution as it declared it (`ReportedGateResult.blamesSpan`,
   * `src/tickVerdict.ts`), reported so the leg's blame verdict reads the
   * declaration rather than inferring one.
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
type SpanCarried<L> =
  /**
   * Trunk was not this carry's to move: a live foreign tip claim refused
   * ahead of everything, or a writer landed under the judged candidate and
   * the fast-forward was no longer a fast-forward. Either way trunk stands
   * where it stood, holds nothing of this span, and the span is carried again
   * by whatever tick next has it.
   *
   * `movedTo` is the tip trunk stands at where that is not the tip the
   * candidate was cut from — the writer above, the carry's own absorption
   * already spent on an earlier one ({@link MOVED_TIP_ABSORPTIONS}). Absent
   * is the claim refusing ahead of the pick, trunk standing exactly where the
   * candidate was cut. A fact, never a verdict — what a second mover means
   * for a queue is the leg's (`.claude/rules/engine-boundary.md`, *Surface,
   * not prescription*).
   */
  | { fate: "tip-moved"; movedTo?: string }
  /**
   * The checkout declined the move, not the branch: trunk still stands at the
   * tip the candidate was cut from, and an uncommitted change on a path the
   * span touched is what the fast-forward would have overwritten
   * (`fastForwardTo`, `src/git.ts`). Its own fate rather than `tip-moved`
   * above, which the engine already tells it from at the refusal
   * (`FastForwardRefusedError.tipSha`, `src/git.ts`): nothing moved, so there
   * is no new tip to carry onto and no later tip that clears it — the work in
   * that tree is a bystander's to commit or discard, and a carry made again
   * meets the same refusal.
   */
  | { fate: "uncommitted-work" }
  /** The pick hit a real conflict: the candidate is discarded and trunk holds nothing of this span. */
  | {
      fate: "cherry-pick-conflict";
      /** The conflict's own stage failure, unblamed ({@link StageFacts}). */
      failure: StageFacts;
      /**
       * What the span would have added, captured off its own two commits
       * before the candidate went — best-effort, and absent when even that
       * read failed. Read by a leg whose rewrite keys footprints by tag
       * (`commitPendingUpdate`, `src/pendingLedger.ts`); a span with no entry
       * has no tag to key one under.
       */
      footprint?: string[];
    }
  /** A gate turned red over the candidate: it is discarded, trunk never named the span, and the span is the leg's to retry. */
  | (SpanRevert & { fate: "afterMerge-reverted" })
  /**
   * The span is on trunk: its gates were green over the candidate, the leg
   * landed what ships it there, and trunk fast-forwarded to the result.
   * `landing` is whatever that leg's own step answered with ({@link
   * carryMergeSpan}'s `land`), handed back only here — the one exit at which
   * trunk holds what it produced.
   */
  | (SpanLanded & { fate: "merged"; landing: L });

/**
 * Carry one span onto trunk and answer with what became of it.
 *
 * The order is the whole of what this function is: refuse to a live foreign
 * claim before any candidate is built, build a provisioned candidate at the
 * tip trunk stands at, pick the range onto the candidate, gate the candidate,
 * let the leg land what ships the span on it, and fast-forward trunk to the
 * result. Each step's reason is at the step, in the step's own function — the
 * ones the batch carry below runs over N spans instead of one
 * ({@link carryMergeBatch}).
 *
 * That order runs again, once, where trunk declined the move because a writer
 * landed under the candidate: the span is carried onto the tip it left rather
 * than walled by it ({@link carryAbsorbingMovedTip}), which is what absorption
 * means at this site.
 *
 * **Every exit short of the fast-forward discards one directory.** There is no
 * reset, no revert and no rewind: a red gate, a conflicting pick, a refused
 * fast-forward and a throw all leave trunk at the tip it was read at, so no
 * copy of the branch can hold history trunk later drops (spec/worktrees.md,
 * *Per-entry `afterMerge` revert isolation*).
 */
export async function carryMergeSpan<L>(carry: {
  /** The tick's leg: the primary checkout trunk is read and moved on, its log, its record store, its tip claim. */
  leg: TickLegContext;
  /** The phase whose `afterMerge` gates judge the candidate, and whose provisioning hooks build it. */
  phase: Phase;
  /** The span's base — the tip its agent branched from, and the pick range's lower end. */
  base: string;
  /** The span's head — the last commit the agent left on its worktree branch. */
  head: string;
  /**
   * The session this span carries — the entry and its steps as the queue
   * listing its slot pulled from held them, for the gates that read it
   * (`GateContext.assignment`, `src/Gate.ts`). Absent on a singleton phase's
   * span, which is assigned nothing; one value, so what reaches the gates is
   * the leg's whole account of the session rather than half of one.
   */
  assignment?: GateAssignment;
  /** Where a gate revert's prior-attempt record lands (`priorAttemptRef`, `src/priorAttempts.ts`). */
  ref: PriorAttemptRef;
  /**
   * One `afterMerge` gate row and what it cost, handed over as the gate
   * returns rather than collected and answered at the end: a throw past this
   * point is a tick whose verdict still names every gate that ran
   * (spec/loop.md "The tick verdict — one facts artifact").
   */
  onGateRow: (row: ReportedGateResult, ms: number) => void;
  /**
   * What the leg lands on a candidate every `afterMerge` gate ruled green,
   * before trunk fast-forwards to it: a wave's `shipped` consult and the
   * ledger rewrite that retires what shipped, a singleton's nothing at all.
   *
   * Here rather than one `await` past the return, because the span and the
   * commit that ships it reach trunk in a **single** fast-forward: a step run
   * after this returns would be a second move, and the instant between the two
   * is exactly the state this shape exists to delete (spec/loop.md, *The ship
   * lock and the worktree lock — sibling ticks take turns at git*).
   *
   * Its answer rides the `merged` arm and nothing else, so a leg applies it to
   * its own stage only once trunk holds what it describes. A fast-forward
   * refused after this ran leaves the work on a candidate about to be
   * discarded — the entry stays pending, which is the same verdict the leg
   * would have reached had the gates gone red.
   */
  land: (green: {
    /** The candidate the leg writes and commits in — `repoRoot` for anything it spawns. */
    candidate: string;
  } & SpanLanded) => Promise<L>;
  /** The words this leg reports the carry in ({@link SpanNarration}). */
  narrate: SpanNarration;
}): Promise<SpanCarried<L>> {
  const { leg, phase, narrate } = carry;
  return carryAbsorbingMovedTip<SpanCarried<L>>(
    leg,
    narrate.tipClaimed,
    // Refused ahead of the candidate and the pick, so trunk holds nothing of
    // this span. The leg's row is the whole recovery handle: the span's
    // commits outlive the branch teardown deletes
    // (`TickVerdictMergeOutcome`, `src/tickVerdict.ts`).
    { fate: "tip-moved" },
    (carryAgain) =>
      withProvisionedCandidate(
        leg,
        phase,
        carry.assignment?.entry.tag ?? phase.name,
        (candidate) => carryOntoCandidate(carry, candidate, carryAgain),
      ),
  );
}

/**
 * How many times a carry whose fast-forward trunk declined *over a tip that
 * moved* is made again, onto the tip that moved it. One.
 *
 * A foreign commit under the candidate is legal history, and absorbing it at a
 * harness commit site means picking onto whatever tip is current (spec/loop.md,
 * *Tip verify — one writer per branch, absorption at the merge*) — which at
 * this site is a candidate cut at the tip it left, the whole carry run there,
 * and trunk fast-forwarded to that. Refusing instead would wall a span over an
 * operator committing law or prompts mid-run, which is the interference this
 * section says is not one.
 *
 * Bounded, and bounded out loud: each absorption pays for one more full
 * `afterMerge` gate run under the ship lock, so a writer committing in a loop
 * would hold that lock for as long as it kept going. Past the bound the carry
 * answers `tip-moved` naming the tip it saw, and the span is carried again by
 * the tick that next holds it — no commit, nothing dropped, the entry pending
 * exactly as every other refusal leaves it.
 */
const MOVED_TIP_ABSORPTIONS = 1;

/**
 * Run a carry, and run it again on the tip a writer left under its candidate
 * ({@link MOVED_TIP_ABSORPTIONS}).
 *
 * One home for the absorption both carries take — a single span's
 * ({@link carryMergeSpan}) and a batch's ({@link carryMergeBatch}) — because
 * the refusal they meet is the same one and the tip they would re-cut at is
 * read the same way (`.claude/rules/engineering.md`, *The fix lands at the
 * mechanism*).
 *
 * The live foreign claim is asked once per **attempt** rather than once per
 * carry: a second engine that took the ref while this candidate was being
 * judged is exactly the mover absorption must not launder (spec/loop.md,
 * *Harness-driven commits carry no expected-tip bookkeeping — the claim
 * refuses, git arbitrates*), and it costs one read of one file.
 *
 * `attempt` is told whether a refusal over a moved tip will be carried again,
 * which the leg needs to word its own refusal line and nothing else: the
 * decision is this loop's.
 */
async function carryAbsorbingMovedTip<
  C extends { fate: string; movedTo?: string },
>(
  leg: TickLegContext,
  tipClaimed: (pid: number) => string,
  /** The fate a live foreign claim answers with — the one refusal absorption never touches. */
  claimed: C,
  attempt: (carryAgain: boolean) => Promise<C>,
): Promise<C> {
  for (let absorptions = MOVED_TIP_ABSORPTIONS; ; absorptions--) {
    // Trunk's: the claim is a statement about the ref, so a read of it that
    // fails leaves no span carryable ({@link MergeWallScope}).
    if (
      await declareMergeWall("trunk", "the foreign tip-claim read", () =>
        foreignTipRefusal(leg, tipClaimed),
      )
    )
      return claimed;
    const carried = await attempt(absorptions > 0);
    // A tip to carry onto is the whole precondition: every other fate — the
    // merge, the red, the conflict, and the checkout whose uncommitted work
    // declined the move, which no later tip clears — answers as it stands.
    if (carried.movedTo === undefined || absorptions === 0) return carried;
  }
}

/**
 * Build the merge candidate a carry picks onto and run `body` in it: the tip
 * trunk stands at read once under the caller's ship lock, a tree of its own
 * cut there (`withMergeCandidate`, `src/worktrees.ts`), the chain's
 * provisioning hooks around it, and the discard on every exit.
 *
 * One home for the frame both carries open — one span's
 * ({@link carryMergeSpan}) and a batch's ({@link carryMergeBatch}) — because
 * the two differ in what they pick into the tree and in nothing about the tree
 * itself (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * `trunkTip` reaches `body` beside the path because the one read answers three
 * questions: the candidate is cut there, a pick's footprint is diffed from
 * there, and the fast-forward at the end moves trunk from there. Read before
 * the candidate exists rather than off it afterwards, so all three read the
 * same value.
 */
async function withProvisionedCandidate<T>(
  leg: TickLegContext,
  phase: Phase,
  /**
   * What the provisioning hooks are told this tree is for: the entry's tag
   * where the carry has one, the phase's name where it has none — a batch,
   * whose candidate holds N entries and is no more one of them than the gate
   * context over it is (`batchGateContext`, `src/gateBatch.ts`).
   */
  worktreeKey: string,
  body: (candidate: string, trunkTip: string) => Promise<T>,
): Promise<T> {
  const repoRoot = leg.repoRoot;
  // Trunk's: the tip every candidate of this carry is cut at, so a read that
  // fails is not one span's problem ({@link MergeWallScope}).
  const trunkTip = await declareMergeWall("trunk", "the trunk tip read", () =>
    git.revParse(repoRoot),
  );
  // And the tree itself is this carry's own — the `git worktree add`, the
  // chain's provisioning hook over it, the removal — so a frame that will not
  // provision is the span's wall and not the wave's, exactly as a build
  // worktree that would not provision is one entry's (`runFanout`,
  // `src/waveTick.ts`). The body's own steps declare for themselves and pass
  // through ({@link declareMergeWall}).
  return declareMergeWall("span", "the merge candidate's provisioning", () =>
    withMergeCandidate(leg.worktreeCtx, trunkTip, async (candidate) => {
      // Provisioned the way a build worktree is, which includes whatever the
      // chain materializes for the gates (spec/worktrees.md, *`setupWorktree`
      // and `teardownWorktree` — the chain's provisioning hooks*): a candidate
      // holds tracked files only, and the gates that judge it are the same ones
      // a worktree's install exists for. A throw propagates as the frame's own
      // wall — the candidate is discarded by the carry and trunk is untouched,
      // and a merge that cannot provision the tree it judges in has no verdict
      // to report (`.claude/rules/engineering.md`, *Loud or nothing*).
      if (phase.setupWorktree) {
        await phase.setupWorktree({
          worktreePath: candidate,
          repoRoot,
          worktreeKey,
        });
      }
      try {
        return await body(candidate, trunkTip);
      } finally {
        // The counterpart hook, best-effort by contract: a leaked resource is
        // recoverable, and a throw here would take the carry's verdict with it
        // (spec/worktrees.md, *`setupWorktree` and `teardownWorktree` — the
        // chain's provisioning hooks*).
        if (phase.teardownWorktree) {
          try {
            await phase.teardownWorktree({
              worktreePath: candidate,
              repoRoot,
              worktreeKey,
            });
          } catch (err) {
            leg.log.warn(
              `[flume] teardownWorktree failed for the merge candidate at ${candidate}: ${thrownMessage(err)}`,
            );
          }
        }
      }
    }),
  );
}

/**
 * Move trunk to whatever the candidate became — the one fast-forward both
 * carries end at, over the sha read *after* the leg's landing step, so the
 * move carries the picks and the commit that ships them together.
 *
 * Answers whether trunk moved, and on a refusal which of the two refusals it
 * was ({@link TrunkMove}). A refusal is a fact, not an error: something landed
 * on the branch under this candidate, or the move would overwrite an
 * uncommitted change on a path a pick touched. Git moved nothing either way,
 * so the candidate is the only thing discarded (spec/worktrees.md, *Per-entry
 * `afterMerge` revert isolation*).
 */
async function fastForwardTrunk(move: {
  leg: TickLegContext;
  /** The tree trunk is to become. */
  candidate: string;
  /** The tip the candidate was cut at, for the refusal's own line. */
  landedOnSha: string;
  /**
   * Whether a refusal over a moved tip is to be carried again onto it
   * ({@link carryAbsorbingMovedTip}) — read for the leg's wording alone, so
   * this step never decides what the refusal means.
   */
  carryAgain: boolean;
  /** How this leg words the refusal ({@link SpanNarration.fastForwardRefused}). */
  refused: SpanNarration["fastForwardRefused"];
}): Promise<TrunkMove> {
  const { leg } = move;
  // The candidate's own tip: this span's tree, so a read that fails ends this
  // span ({@link MergeWallScope}).
  const candidateSha = await declareMergeWall(
    "span",
    "the candidate tip read",
    () => git.revParse(move.candidate),
  );
  try {
    await git.fastForwardTo(leg.repoRoot, candidateSha);
  } catch (err) {
    // A refusal is the step's own answer below, never a wall. Anything else is
    // the move on the shared ref failing, which is trunk's by construction:
    // what the next carry would read is the thing that just would not answer.
    if (!(err instanceof git.FastForwardRefusedError))
      throw new MergeWall("trunk", "the fast-forward of trunk", err);
    // Which refusal this was, read off the tip git stood at when it refused
    // (`git.FastForwardRefusedError`) rather than out of the words it raised:
    // a tip that is no longer the one this candidate was cut from is a writer
    // landed under it, and a candidate cut at the tip trunk still holds is a
    // descendant by construction, so only that checkout's own uncommitted
    // work can have declined it.
    const movedTo =
      err.tipSha === move.landedOnSha ? undefined : err.tipSha;
    leg.log.warn(
      move.refused({
        candidateSha,
        landedOnSha: move.landedOnSha,
        refusal: err.gitMessage,
        ...(movedTo !== undefined && move.carryAgain
          ? { carriedAgainOnto: movedTo }
          : {}),
      }),
    );
    return movedTo === undefined
      ? { moved: false, refusal: "uncommitted-work" }
      : { moved: false, refusal: "tip-moved", movedTo };
  }
  return { moved: true };
}

/**
 * What the one fast-forward answered: trunk became the candidate, or it stands
 * where it stood and `refusal` says which of the two refusals that was — the
 * branch moved under the candidate, or the checkout's own uncommitted work
 * declined it. Named here rather than read off an absent `movedTo`, so the
 * carries below row the fate the step decided instead of re-deriving it
 * ({@link SpanCarried} carries both on, in the same spelling).
 */
type TrunkMove =
  | { moved: true }
  | { moved: false; refusal: "tip-moved"; movedTo: string }
  | { moved: false; refusal: "uncommitted-work" };

/**
 * The half of {@link carryMergeSpan} that runs inside a provisioned
 * candidate: the pick, the gates, the leg's landing step and the one
 * fast-forward.
 *
 * Split from the carry so the candidate's whole lifetime — provisioning,
 * teardown hook, removal — is one `withMergeCandidate` frame the branches
 * below cannot fall out of, and so each of those branches is a plain `return`
 * rather than a flag the frame has to interpret.
 */
async function carryOntoCandidate<L>(
  carry: Parameters<typeof carryMergeSpan<L>>[0],
  candidate: string,
  /** Passed straight to the fast-forward, for the leg's wording ({@link fastForwardTrunk}). */
  carryAgain: boolean,
): Promise<SpanCarried<L>> {
  const { leg, phase, base, head, narrate } = carry;
  const repoRoot = leg.repoRoot;
  // This span's own range onto this span's own candidate: a read of either
  // that fails ends this span and implicates nothing shared
  // ({@link MergeWallScope}). A real conflict is the step's answer, not a wall.
  const picked = await declareMergeWall(
    "span",
    "the cherry-pick of the span",
    () => pickSpanRange({ leg, tree: candidate, base, head, narrate }),
  );
  if (picked.fate === "cherry-pick-conflict") return picked;
  const { mergedSha, landedOnSha, touchedPaths } = picked;
  const landed: SpanLanded = { mergedSha, landedOnSha, touchedPaths };
  // The gates judge this candidate, and a gate that throws is already that
  // gate's red (`runGate`, `src/gateRun.ts`) — so what is left to declare here
  // is the loop's own material, which is this span's
  // ({@link MergeWallScope}).
  const failingGate = await declareMergeWall(
    "span",
    "the afterMerge gates over the candidate",
    () =>
      gateMergedTip(
        leg,
        phase,
        {
          ...gateSite(leg, phase, candidate),
          commitSha: mergedSha,
          touchedPaths,
          // One span is one session, and a session's footprint is the entry's
          // declaration and its steps' together, so the gates read the pair as
          // one value (`GateContext.assignment`, `src/Gate.ts`).
          ...(carry.assignment ? { assignment: carry.assignment } : {}),
          // The span's own base, not the tip it landed on: an `afterMerge`
          // gate reading the candidate needs the tip its agent branched from
          // to tell an input the span ignored from one that landed after it
          // started (spec/chain.md "What a gate receives"). Siblings
          // provisioned from the same tip each carry their own value
          // regardless.
          baseSha: base,
          // And the tip it landed onto beside it, which is what a cumulative
          // gate measuring the tree before and after this span reads as its
          // *before* (spec/chain.md "What a gate receives").
          landedOnSha,
        },
        carry.onGateRow,
      ),
  );
  if (failingGate) {
    leg.log.warn(narrate.gateFailed(failingGate.gate));
    // Nothing to take back off: the candidate carries the span and trunk never
    // named it, so the whole cost of the red is one directory and the N−1
    // siblings trunk has already fast-forwarded to stay shipped.
    //
    // The digest is captured while the candidate's sha is still reachable,
    // over the pair the pick produced. Not `mergedSha` alone: over a span
    // trunk already held whole the two are equal, and digesting the tip would
    // hand the retry whichever writer's commit is standing there as its own
    // prior attempt (spec/loop.md "Prior-outcome feedback to the retrying
    // tick"). Read through `repoRoot`, which shares the candidate's object
    // store, so the digest does not depend on the directory outliving it.
    //
    // This span's own record, in this span's own slot, so the step is the
    // span's: a store that will not take it costs the retry its prior-attempt
    // block and costs no sibling anything ({@link MergeWallScope}).
    await declareMergeWall(
      "span",
      "the gate-revert prior-attempt record",
      async () => {
        const record = await buildGateRevert(
          "afterMerge",
          failingGate,
          repoRoot,
          { base: landedOnSha, head: mergedSha },
        );
        await leg.attempts.write(carry.ref, record);
      },
    );
    return {
      fate: "afterMerge-reverted",
      ...landed,
      gateFailure: {
        signature: gateFailureSignature(failingGate),
        message: failingGate.message,
      },
      blamesSpan: failingGate.blamesSpan,
    };
  }
  // Green. Whatever ships the span lands on the candidate too, so the
  // fast-forward below carries both in one move and no instant exists at which
  // trunk holds one without the other (spec/loop.md "The ship lock and the
  // worktree lock — sibling ticks take turns at git").
  //
  // Not declared here: what the leg lands is the leg's step, and so is its
  // scope — a wave's `shipped` consult is one span's and its ledger rewrite is
  // trunk's (`src/waveMerge.ts`). An undeclared throw out of it reads as
  // trunk's ({@link readMergeWall}).
  const landing = await carry.land({ candidate, ...landed });
  const moved = await fastForwardTrunk({
    leg,
    candidate,
    landedOnSha,
    carryAgain,
    refused: narrate.fastForwardRefused,
  });
  if (!moved.moved) {
    // Trunk declined, so this span is carried again — onto the tip a writer
    // left under the candidate ({@link carryAbsorbingMovedTip}), or by the
    // tick that next holds the entry. `landing` is dropped with the candidate
    // it was written into either way: the leg never sees it, so nothing it
    // describes is reported as shipped. The refusal the step named is the
    // fate: a checkout that declined the move is not a branch that moved, and
    // only the second is carried again here.
    return moved.refusal === "uncommitted-work"
      ? { fate: "uncommitted-work" }
      : { fate: "tip-moved", movedTo: moved.movedTo };
  }
  leg.log.info(narrate.merged(mergedSha, landedOnSha));
  return { fate: "merged", ...landed, landing };
}

/**
 * One span a batched merge is asked to carry: the range, the entry whose facts
 * the batch's gates read for it, and the words its own pick is reported in.
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
  /** The session this span carries, for the batch's gates to read as its own ({@link GateBatchSpan}). */
  assignment?: GateAssignment;
  /** The words this span's own pick is reported in. */
  narrate: Pick<SpanNarration, "pickFailed" | "absorbed" | "merged">;
}

/**
 * The words a leg reports the batch's own steps in — the ones that hold over
 * every span it carried rather than over one of them, on
 * {@link SpanNarration}'s terms.
 *
 * The fast-forward's refusal is spelled by the single-span function itself,
 * unchanged: that sentence is about trunk and a candidate and names neither
 * the spans nor how many there were, so a second wording of it would be a
 * second vocabulary for one fact.
 */
type BatchNarration = Pick<SpanNarration, "fastForwardRefused"> & {
  /** A live foreign tip claim refused the whole batch, by the pid holding it. */
  tipClaimed(pid: number): string;
  /** An `afterMerge` gate turned red over the batch's candidate, by gate name. */
  gateFailed(gate: string): string;
  /** The candidate is discarded, and why — its spans merge one at a time instead. */
  discarded(why: string): string;
};

/**
 * What became of a batched merge (spec/worktrees.md, *Batched merges*).
 *
 * `discarded` is the one fate a single-span carry has no equivalent of: the
 * candidate went with nothing of it on trunk, and the spans are the leg's to
 * carry one at a time, gated individually. It is not a verdict on any span —
 * the serial pass that follows is what produces those — so it carries only the
 * words the discard happened in, for the leg's log and nothing else.
 */
type BatchCarried<L> =
  /**
   * Trunk was not this batch's to move: a live foreign tip claim refused ahead
   * of everything, or a writer landed under the judged candidate. Either way
   * trunk stands where it stood and holds nothing of any span. `movedTo`
   * carries the same fact at a width that a single span's arm does
   * ({@link SpanCarried}).
   */
  | { fate: "tip-moved"; movedTo?: string }
  /**
   * The checkout declined the move: an uncommitted change on a path one of
   * the batch's spans touched, exactly as a single span's own arm reports it
   * ({@link SpanCarried}). Trunk holds nothing of any span.
   */
  | { fate: "uncommitted-work" }
  /** Red, or a conflict while picking: the candidate is discarded and trunk named no span of it. */
  | { fate: "discarded"; why: string }
  /**
   * Every span is on trunk: picked in order onto one candidate, gated once
   * over it, and carried there by the one fast-forward past the leg's landing
   * step — whose answer is `landing`, handed back only here.
   */
  | { fate: "merged"; landed: readonly SpanLanded[]; landing: L };

/**
 * Carry a batch of spans onto trunk and answer with what became of all of them
 * (spec/worktrees.md, *Batched merges*): cherry-picked in order onto **one**
 * candidate, the `afterMerge` gates run once over it, shipped in the leg's one
 * ledger commit and one fast-forward, and discarded with that candidate when a
 * gate turns red or a pick conflicts.
 *
 * Every step is {@link carryMergeSpan}'s own, over N spans instead of one: the
 * same foreign-claim refusal ahead of everything, the same absorption of a
 * trunk that moved under the candidate ({@link carryAbsorbingMovedTip}) — the
 * whole batch re-picked onto the tip the writer left, since the candidate it
 * was judged in has gone — the same candidate frame
 * ({@link withProvisionedCandidate}), the same pick per span, the same gate
 * loop — handed a {@link BatchGateContext} instead of a single span's, which
 * is the whole of what a gate declaring `batches: true` bought
 * (`mergeBatchWidth`, `src/gateBatch.ts`) — and the same one fast-forward
 * ({@link fastForwardTrunk}).
 *
 * What it does **not** do is decide anything per span. No `shipped` consult,
 * no prior-attempt record, no gate failure recorded: a green batch's spans
 * each have their own, and a discarded one's are re-carried individually by
 * the leg, so a verdict taken here would be a second, contradictory fate for
 * the same span. The leg reads `landed` for the green case and re-enters the
 * single-span carry for the discarded one (`src/waveMerge.ts`).
 *
 * **Nothing is ever taken back off trunk.** A red gate, a conflicting pick, a
 * refused fast-forward and a throw all discard one directory and leave trunk
 * at the tip the candidate was cut from — so the serial pass begins at exactly
 * the tree it would have begun at had the batch never run, and no reader of
 * the branch can hold history trunk later drops.
 */
export async function carryMergeBatch<L>(carry: {
  /** The tick's leg: the primary checkout trunk is read and moved on, its log, its tip claim. */
  leg: TickLegContext;
  /** The phase whose `afterMerge` gates judge the batch's candidate, and whose hooks provision it. */
  phase: Phase;
  /** The spans to pick, in the order they are to land. At least two — one span is {@link carryMergeSpan}. */
  spans: readonly BatchSpanInput[];
  /** One `afterMerge` gate row and what it cost, on {@link carryMergeSpan}'s terms. */
  onGateRow: (row: ReportedGateResult, ms: number) => void;
  /**
   * What the leg lands on a candidate every `afterMerge` gate ruled green,
   * before trunk fast-forwards to it: a wave's per-span `shipped` consults and
   * the one ledger commit that retires what they named.
   *
   * Here rather than one `await` past the return, for {@link carryMergeSpan}'s
   * own reason, at a width: the batch's spans and the commit that ships them
   * reach trunk in a **single** fast-forward (spec/worktrees.md, *Batched
   * merges*). Its answer rides the `merged` arm and nothing else, so a refused
   * move leaves the leg holding no verdict for work trunk never named.
   */
  land: (green: {
    /** The candidate the leg writes and commits in — `repoRoot` for anything it spawns. */
    candidate: string;
    /** What each span landed as, in the order they were picked. */
    landed: readonly SpanLanded[];
  }) => Promise<L>;
  /** The words this leg reports the batch's own steps in ({@link BatchNarration}). */
  narrate: BatchNarration;
}): Promise<BatchCarried<L>> {
  const { leg, phase, spans, narrate } = carry;
  if (spans.length < 2) {
    // Trunk's: a caller that reached here is an engine bug, and the loud exit
    // it has always taken is the one this scope keeps ({@link readMergeWall}).
    throw new MergeWall(
      "trunk",
      "the batch width check",
      new Error(
        `a batched merge of ${spans.length} span(s) is the single-span ` +
          `carry under another name: a batch withholds every per-span fact ` +
          `from its gates, so carrying one span through here would gate it ` +
          `over a context that names no entry`,
      ),
    );
  }
  return carryAbsorbingMovedTip<BatchCarried<L>>(
    leg,
    narrate.tipClaimed,
    { fate: "tip-moved" },
    (carryAgain) =>
      withProvisionedCandidate(
        leg,
        phase,
        // No entry names this tree: the gates over it are handed every span's
        // assignment and none of them as *the* one, and a provisioning hook is
        // owed the same account of what it is provisioning for
        // (`batchGateContext`, `src/gateBatch.ts`).
        phase.name,
        async (candidate, trunkTip) => {
          const landed: SpanLanded[] = [];
          const gateSpans: GateBatchSpan[] = [];
          /**
           * Give up the candidate. Nothing is reset and nothing is aborted: the
           * tree the picks landed in is the thing discarded, and trunk has not
           * moved since it was cut.
           */
          const discard = (why: string): BatchCarried<L> => {
            leg.log.warn(narrate.discarded(why));
            return { fate: "discarded", why };
          };
          for (const span of spans) {
            const picked = await declareMergeWall(
              "span",
              "the cherry-pick of the span",
              () =>
                pickSpanRange({
                  leg,
                  // One candidate for the whole batch, so span N+1 picks onto
                  // what span N left and the gates judge the tree every span
                  // of the batch produced together — which is the whole of
                  // what batching buys.
                  tree: candidate,
                  base: span.base,
                  head: span.head,
                  narrate: span.narrate,
                }),
            );
            if (picked.fate === "cherry-pick-conflict") {
              // A conflict is the batch's verdict; each span's own is the serial
              // pass's to take. The spans picked ahead of it need no taking back —
              // they are on the candidate, and the candidate goes.
              return discard(`cherry-pick conflict: ${picked.failure.message}`);
            }
            landed.push(picked);
            gateSpans.push({
              ...(span.assignment ? { assignment: span.assignment } : {}),
              commitSha: picked.mergedSha,
              baseSha: span.base,
              landedOnSha: picked.landedOnSha,
              touchedPaths: picked.touchedPaths,
            });
          }
          const failingGate = await declareMergeWall(
            "span",
            "the afterMerge gates over the candidate",
            () =>
              gateMergedTip(
                leg,
                phase,
                // Every per-span fact on the span records, every batch-wide
                // fact computed from them (`batchGateContext`,
                // `src/gateBatch.ts`) — never restated here.
                batchGateContext(gateSite(leg, phase, candidate), gateSpans),
                carry.onGateRow,
              ),
          );
          if (failingGate) {
            leg.log.warn(narrate.gateFailed(failingGate.gate));
            // No prior-attempt record and no gate failure reported for the batch's
            // own red: the serial pass below it re-runs these gates per span, and
            // the entry each of them blames is the one that pass condemns. A
            // record written here would name every span for a verdict one of them
            // earned.
            return discard(
              `afterMerge gate '${failingGate.gate}' failed over the batch: ${failingGate.message}`,
            );
          }
          // Green. Whatever ships the spans lands on the candidate too, so the
          // fast-forward below carries the batch and the commit that retires it in
          // one move and no instant exists at which trunk holds one without the
          // other (spec/loop.md "The ship lock and the worktree lock — sibling
          // ticks take turns at git").
          const landing = await carry.land({ candidate, landed });
          const moved = await fastForwardTrunk({
            leg,
            candidate,
            // The tip the candidate was cut at — the batch's own lower end, and
            // the tip trunk stays at when the move is declined.
            landedOnSha: trunkTip,
            carryAgain,
            refused: narrate.fastForwardRefused,
          });
          if (!moved.moved) {
            // Trunk declined, so every span of the batch is where a refused
            // single-span carry leaves its own: nothing on trunk, the entry
            // pending, and the whole batch carried again — onto the tip a writer
            // left under this candidate ({@link carryAbsorbingMovedTip}), or by
            // the tick that next holds these entries. `landing` is dropped with
            // the candidate it was written into. Which refusal it was is the
            // step's answer, at a batch's width exactly as at one span's.
            return moved.refusal === "uncommitted-work"
              ? { fate: "uncommitted-work" }
              : { fate: "tip-moved", movedTo: moved.movedTo };
          }
          for (const [i, span] of spans.entries()) {
            const l = landed[i]!;
            leg.log.info(span.narrate.merged(l.mergedSha, l.landedOnSha));
          }
          return { fate: "merged", landed, landing };
        },
      ),
  );
}

/**
 * The live foreign tip claim both carries refuse to, before anything is
 * picked (`liveForeignClaimPid`, `src/tipVerify.ts`).
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
 * One refusal per carry **attempt**, never per span of a batch: the claim is a
 * statement about the ref, so asking it per span would read the same disk N
 * times to answer N identical questions — while a carry made again onto a tip
 * that moved asks afresh, because the mover it must not launder can arrive in
 * exactly that window ({@link carryAbsorbingMovedTip}).
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
      /** What the span would have added, read off its own base and head before the candidate goes. */
      footprint?: string[];
    }
  | ({ fate: "picked" } & SpanLanded);

/**
 * Pick one span's range onto the candidate it is handed: the range itself and
 * the facts of where it landed.
 *
 * One home for the step both carries take — once for a single span
 * ({@link carryMergeSpan}), once per span of a batch
 * ({@link carryMergeBatch}) — so what a pick absorbs and what it reports has
 * one spelling (`.claude/rules/engineering.md`, *The fix lands at the
 * mechanism*). The foreign-claim refusal is **not** here: it is one question
 * per carry, asked by the caller ({@link foreignTipRefusal}).
 */
async function pickSpanRange(pick: {
  leg: TickLegContext;
  /**
   * The candidate the range is picked onto: one span's own
   * ({@link carryMergeSpan}) or the one a batch shares
   * ({@link carryMergeBatch}). Never the primary checkout — a pick there would
   * write the tree an operator has work in, which is the write this module
   * does not make.
   */
  tree: string;
  /** The span's base — the pick range's lower end. */
  base: string;
  /** The span's head — the pick range's upper end. */
  head: string;
  narrate: Pick<SpanNarration, "pickFailed" | "absorbed">;
}): Promise<SpanPicked> {
  const { leg, tree, base, head, narrate } = pick;
  const landedOnSha = await git.revParse(tree);
  // The commits of this span trunk already held. A range pick absorbs those
  // rather than refusing over them (`git.cherryPickRange`), so only a real
  // conflict reaches the catch below. The whole range, in order, rather than
  // the newest commit alone: the attempt's own ancestry check already cleared
  // `base..head` as one completed span (spec/loop.md "The check is ancestry,
  // and N commits are completion"), and a one-commit span is the same call.
  let absorbed: readonly string[] = [];
  try {
    ({ absorbed } = await git.cherryPickRange(tree, base, head));
  } catch (err) {
    const message = thrownMessage(err);
    leg.log.warn(narrate.pickFailed(message));
    let footprint: string[] | undefined;
    try {
      footprint = await git.diffNameOnly(tree, base, head);
    } catch {
      // Footprint capture is best-effort; a retry without one partitions on
      // the entry's declared files as before.
    }
    // No abort: the stopped sequence is the candidate's, and the candidate is
    // discarded whole by the frame this pick runs inside
    // ({@link withProvisionedCandidate}) — `git worktree remove --force`
    // takes the tree, the half-applied index and git's own sequencer
    // bookkeeping together. Aborting first would be one more call that can
    // fail over a directory already condemned.
    return {
      fate: "cherry-pick-conflict",
      failure: stageFailureFacts(message),
      ...(footprint ? { footprint } : {}),
    };
  }
  const mergedSha = await git.revParse(tree);
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
  const touchedPaths = await git.diffNameOnly(tree, landedOnSha, mergedSha);
  return { fate: "picked", mergedSha, landedOnSha, touchedPaths };
}

/**
 * Run the phase's `afterMerge` gates over whatever the merge's pick put in
 * the tree they judge, stopping at the first red and answering with its row.
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
 * Where an `afterMerge` gate is running, for either carry: the tree it judges,
 * this tick's state-root facts and the phase's name — the half of a gate's
 * input that holds however many spans the merge carried ({@link GateSite}),
 * composed once rather than at each of the two sites that add the span facts
 * to it.
 *
 * `tree` is the candidate the merge built — the tree trunk is about to become,
 * whether one span was picked onto it or a batch of them. It is both `cwd` and
 * `repoRoot`, which is the one thing a gate is promised about the two
 * (spec/chain.md, *What a gate receives*).
 *
 * `flumeDir` and `pendingDir` are the **primary checkout's** at both gate
 * points, never rebased: runtime state exists only there, and the queue's
 * location is the chain's own declaration. `configDir` is rebased, as it is
 * for an `afterCommit` gate in its worktree and through the same fold
 * (`rebaseOntoTree`, `src/paths.ts`) — a chain's gate code lives in the tree
 * the gate judges, so an in-repo config dir reached verbatim would point one
 * of the two gate points at a tree it is not running in.
 */
function gateSite(leg: TickLegContext, phase: Phase, tree: string): GateSite {
  return {
    cwd: tree,
    repoRoot: tree,
    flumeDir: leg.flumeDir,
    stateRootRel: leg.stateRootRel,
    pendingDir: leg.pendingDir,
    configDir: rebaseOntoTree(
      tree,
      leg.configDir,
      leg.attemptCtx.configDirRel,
    ),
    phaseName: phase.name,
    log: (l) => leg.log.info(l),
  };
}
