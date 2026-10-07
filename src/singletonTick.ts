/**
 * The singleton leg of a tick: the whole of what a `singleton` phase does
 * between `tick()`'s chain load and its verdict — the decline consult, the
 * wave-of-one worktree it provisions, the one attempt it makes there, and
 * the merge stage that carries that span back onto trunk.
 *
 * spec/worktrees.md "Singleton runs in a worktree": a singleton is a wave of
 * one keyed on the phase name, so it reaches the same provisioning, attempt
 * and afterMerge machinery a fanout entry does — the span carry literally so
 * (`carryMergeSpan`, `src/mergeSpan.ts`) — and what differs is the vocabulary
 * it reports in, which has no entry to tag. That difference is
 * this file; the wave's own is `src/waveTick.ts`, and the orchestration
 * around both is `src/Dispatcher.ts`.
 *
 * Everything it reads off the tick that dispatched it arrives as a
 * {@link TickLegContext} (`src/tickLeg.ts`) — no field is re-derived here,
 * and its two queue reads are the ledger's own (`src/pendingLedger.ts`),
 * taken with that context.
 */

import type { Agent } from "./Agent.js";
import * as git from "./git.js";
import {
  carryMergeSpan,
  type BystanderCheckpoint,
} from "./mergeSpan.js";
import {
  readLedgerFilingTimes,
  readPendingForDecision,
  readPendingTolerant,
} from "./pendingLedger.js";
import type { Chain, Phase, TickContext, TickResult } from "./Phase.js";
import type { NoCommitMode } from "./Prompt.js";
import { priorAttemptRef } from "./priorAttempts.js";
import { bindEntryRefusal, pickableSelection } from "./selection.js";
import { consultShouldRun, runAttempt } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import {
  appendInvocationRow,
  stageFailureFacts,
  startTiming,
  type GateFailure,
  type MergeFailure,
  type ProvisionFailure,
  type ReportedGateResult,
  type TickVerdictMergeOutcome,
  type TickVerdictTiming,
} from "./tickVerdict.js";
import {
  createWorktree,
  teardownWorktreeInstance,
  warnSurvivingWorktrees,
} from "./worktrees.js";
import { thrownMessage } from "./thrown.js";

export async function runSingleton(
  leg: TickLegContext,
  phase: Phase,
  agent: Agent,
  chain: Chain,
  forkResolver?: (repoRoot: string) => (slug: string) => boolean,
): Promise<PhaseTickOutcome> {
  const repoRoot = leg.repoRoot;
  const preHead = await git.revParse(repoRoot);
  // spec/pending.md "Queue reads are strict": strict, with the queue writer's
  // one carve-out — a phase whose declared fence admits the ledger runs over
  // an unparseable queue with the failure as a tick fact, every other phase
  // is refused here before anything is provisioned.
  const { pending, filingTimes, queueParseFailure } =
    await readPendingForDecision(leg, phase);
  // spec/chain.md "What a hook receives": the same selection verdict
  // `runFanout` computes for its own batch, so a singleton `shouldRun` and
  // the next fanout tick cannot disagree.
  const isForkResolved = forkResolver?.(repoRoot) ?? (() => true);
  const capabilities = new Set(chain.capabilities ?? []);
  const quarantinedSlugs = leg.quarantinedSlugs;
  // Read before the selection, because the chain's declared per-entry
  // refusal is judged against each entry's own record and the tip this tick
  // starts from — the same map `ctxFacts` hands the agent below.
  const priorAttempts = await leg.attempts.readAll();
  // spec/pending.md "Claims — an entry in flight is left alone": the entries
  // a build tick is carrying right now. Read here for the same reason the
  // records above are — the selection is where they are consulted — and
  // handed to the agent below as `TickContext.claimed`, so a producer
  // rendering the queue is told which of its entries are someone's.
  const claimedSlugs = await leg.claims.readLive();
  const selected = pickableSelection({
    pending,
    filingTimes,
    isForkResolved,
    capabilities,
    ...(quarantinedSlugs !== undefined ? { quarantinedSlugs } : {}),
    claimedSlugs,
    refuses: bindEntryRefusal(chain, { priorAttempts, headSha: preHead }),
    // The chain's own sequencing policy over the set this hook is handed, so
    // a producer reading `TickContext.pickable` sees the queue in the order
    // the next fanout wave will carry it (`spec/chain.md`, "`Chain.order` —
    // the queue's sequencing policy"). A singleton tick carries no entry, so
    // nothing of its own is in flight.
    order: chain.order,
    inFlight: [],
  });
  const pickable = selected.pickable;

  const ref = priorAttemptRef(phase);

  const noRunResult = async (): Promise<TickResult> => ({
    phaseName: phase.name,
    committed: false,
    gateResults: [],
    pendingAfter: pending,
    pickableAfter: pickable,
    refusedTags: selected.refusedTags,
    // The set this tick read, paired with the selection above: no agent ran,
    // so nothing about the claims on disk changed under it.
    claimedTags: selected.claimedTags,
    // Re-read, not the map above: a `shouldRun` that threw persisted its own
    // render-refused record between the two reads, and a handoff handed the
    // opening map would be told this tick left no refusal behind
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*).
    priorAttempts: await leg.attempts.readAll(),
    flumeDir: leg.flumeDir,
    configDir: leg.configDir,
    shippedTags: [],
    revertedTags: [],
    ...(queueParseFailure ? { queueParseFailure } : {}),
  });

  // spec/loop.md "Declining a tick before the invocation": every
  // `TickContext` field but `cwd` is a fact this tick already holds, so
  // the decline consult and `promptArgs` read one object — the worktree
  // path is the single difference, and it is spelled once.
  const ctxFacts = {
    flumeDir: leg.flumeDir,
    stateRootRel: leg.stateRootRel,
    pending,
    pickable,
    claimed: selected.claimedTags,
    priorAttempts,
    ...(queueParseFailure ? { queueParseFailure } : {}),
  };

  // spec/loop.md "Declining a tick before the invocation": consulted
  // ahead of the prune, `createWorktree` and `setupWorktree` — a singleton
  // decline costs the `rev-parse` and the pending read above and nothing
  // else, where it used to pay a full provisioning (dependency install
  // included) to reach a verdict computable from the queue. `cwd` is
  // the repo root because no worktree exists yet, and none will.
  const consult = await consultShouldRun(
    leg.attemptCtx,
    phase,
    { cwd: repoRoot, ...ctxFacts },
    ref,
    phase.name,
  );
  if (consult.verdict === "declined")
    return { result: await noRunResult(), declined: true };
  // A throw is a refusal, never the decline above: no worktree is
  // provisioned either way, but the verdict must not record a chain
  // decision the chain never reached (spec/chain.md, "What a hook
  // receives").
  if (consult.verdict === "refused") {
    return {
      result: { ...(await noRunResult()), noCommit: "render-refused" },
      noCommit: "render-refused",
      // Unblamed: a singleton assigns no entry, so there is nothing to
      // quarantine and the record falls to the consecutive-failure backstop
      // alone — the shape every failure this leg records already takes.
      renderFailures: [consult.failure],
    };
  }

  // spec/worktrees.md "Singleton runs in a worktree": a singleton tick
  // provisions one worktree — a wave of one, keyed on the phase name
  // (there is no entry tag) — through the same machinery `runFanout` uses
  // per entry, so a provisioning wall costs this tick exactly what it
  // would cost a one-entry wave.
  //
  // Every provisioning failure this tick records accumulates here and
  // rides every exit — spec/loop.md "Repeated identical failures —
  // quarantine, then abort": the accounting covers *every* per-entry
  // failure fact the verdict records, so a prune wall whose
  // `createWorktree` then succeeds still reaches the backstop. Repo-level,
  // hence untagged (there is no entry to blame on a singleton at all),
  // same shape `runFanout` gives its wave-level prune.
  const provisionFailures: ProvisionFailure[] = [];
  // Same record on both surfaces: the outcome envelope feeds the verdict and
  // the quarantine accounting, `result` feeds `handoff` — a singleton whose
  // worktree never existed is otherwise indistinguishable there from one that
  // ran and did nothing. Both provisioning legs that give up return through
  // here; each keeps its own `log.warn` naming its stage, and the
  // `setupWorktree` leg its teardown, which has no counterpart on a leg with
  // no worktree to take down.
  const provisionNoRun = async (
    failure: ProvisionFailure,
  ): Promise<PhaseTickOutcome> => {
    provisionFailures.push(failure);
    const failures = [...provisionFailures];
    return {
      result: { ...(await noRunResult()), provisionFailures: failures },
      provisionFailures: failures,
    };
  };
  try {
    await git.pruneWorktrees(repoRoot, leg.log);
  } catch (err) {
    const failure = stageFailureFacts(thrownMessage(err));
    provisionFailures.push(failure);
    leg.log.warn(
      `[flume] ${phase.name}: worktree prune failed (${failure.signature}); continuing — worktree creation may still fail`,
    );
  }

  let wt: { path: string; branch: string };
  try {
    wt = await createWorktree(phase.name, preHead, leg.worktreeCtx);
  } catch (err) {
    const failure = stageFailureFacts(thrownMessage(err));
    leg.log.warn(
      `[flume] ${phase.name}: worktree provisioning failed (${failure.signature}); no tick this cycle`,
    );
    return provisionNoRun(failure);
  }

  /**
   * The singleton's one teardown, taken by both exits that reach it — the
   * setupWorktree-failure exit below and the end-of-tick one. Removal can be
   * exhausted and leave the directory on disk, and a singleton's surviving
   * set is a set of one, so the answer is read and named on the operator's
   * channel rather than dropped (`.claude/rules/engineering.md`, *Loud or
   * nothing*). One spelling for the sentence, shared with the wave's slot
   * tail and the startup sweep (`warnSurvivingWorktrees`, `src/worktrees.ts`).
   */
  const tearDownWorktree = async (): Promise<void> => {
    const removed = await teardownWorktreeInstance(
      phase,
      chain,
      wt,
      phase.name,
      leg.worktreeCtx,
    );
    if (!removed) warnSurvivingWorktrees(leg.log, phase.name, [wt.path]);
  };

  let extraEnv: Record<string, string> | undefined;
  if (phase.setupWorktree) {
    try {
      const r = await phase.setupWorktree({
        worktreePath: wt.path,
        repoRoot,
        worktreeKey: phase.name,
      });
      if (r && r.extraEnv) extraEnv = r.extraEnv;
    } catch (err) {
      const failure = stageFailureFacts(thrownMessage(err));
      leg.log.warn(
        `[flume] ${phase.name}: setupWorktree hook failed (${failure.signature}); no tick this cycle`,
      );
      await tearDownWorktree();
      return provisionNoRun(failure);
    }
  }

  let committed = false;
  let commitSha: string | undefined;
  // spec/loop.md "Crash equals stop": staked the one time this tick's merge
  // stage actually begins a pick range, by the carry that begins it
  // ({@link BystanderCheckpoint}, `src/mergeSpan.ts`). A singleton carries one
  // span, so "once per carrier" is once.
  const checkpoint: BystanderCheckpoint = { attempted: false, sha: undefined };
  const gateResults: ReportedGateResult[] = [];
  // spec/loop.md "The tick verdict — one facts artifact": one
  // `TickVerdictTiming` row per gate run and per merge, paired with the rows
  // above and in the same run order — the attempt's afterCommit rows, then
  // this leg's own afterMerge rows and its one merge row.
  const timings: TickVerdictTiming[] = [];
  // A singleton's own afterCommit/afterMerge gate
  // revert carries no entry tag (nothing to quarantine — see
  // GateFailure's doc), so it falls to the consecutive-failure backstop
  // alone. Same for a merge-stage failure — see MergeFailure's doc.
  const gateFailures: GateFailure[] = [];
  let mergeFailure: MergeFailure | undefined;
  // spec/loop.md "The tick verdict — one facts artifact": "the phase's own
  // single span under singleton". A singleton has no entry to tag, so these
  // rows carry `outcome`/`baseSha`/`headSha` and no `tag` — one row at
  // most, pushed at whichever fate the span reaches. Without it a
  // gate-reverted singleton commit's sha survives nowhere: `commitSha` on
  // the result is set only on a clean ship, and the worktree branch is gone
  // after teardown.
  const mergeOutcomes: TickVerdictMergeOutcome[] = [];

  // spec/loop.md "Declining a tick before the invocation": `promptArgs`
  // runs after provisioning, so it sees `cwd` as the worktree — every
  // other field is the same object the decline consult above read.
  const ctx: TickContext = { cwd: wt.path, ...ctxFacts };

  // The one attempt sequence, on this phase's wave-of-one worktree: render
  // → tip read → invoke → tip verify → afterCommit gates → revert. What is
  // left below is the singleton's own merge stage and its verdict
  // vocabulary.
  const attempt = await runAttempt(leg.attemptCtx, {
    phase,
    chain,
    agent,
    wt,
    ctx,
    ref,
    label: phase.name,
    ...(extraEnv !== undefined ? { extraEnv } : {}),
  });

  // The attempt's own verdict, which the afterMerge stage below may still
  // overwrite with its own `gate-revert`.
  let noCommit: NoCommitMode | undefined = attempt.noCommit;
  // Either tip-verify producer sets this (`TickVerdict.tipMoved`,
  // `src/tickVerdict.ts`): the attempt's own ancestry check on the worktree
  // branch, or the live-foreign-claim refusal the merge stage below takes
  // before its pick.
  let tipMoved = attempt.tipMoved ?? false;
  // spec/chain.md "What a hook receives": the tip this tick's span
  // branched from — the gates' base, reported on the result as `baseSha`.
  // Unset on a render-refused tick: no span was ever started. (A decline
  // never reaches here — it returns above, before the worktree exists.)
  const preWtHead = attempt.spanBase;
  gateResults.push(...attempt.gateResults);
  timings.push(...attempt.timings);
  if (attempt.termination) {
    // spec/loop.md "Every agent invocation leaves a usage row": written the
    // moment this tick's one agent returned, regardless of what the tick goes
    // on to do with the commit — absent when `shouldRun`/render-refusal
    // skipped the invocation entirely. On disk here rather than carried out
    // to the verdict, so the merge stage below, the teardown after it and any
    // crash through either leave the spend already paid readable
    // (`appendInvocationRow`, `src/tickVerdict.ts`).
    //
    // spec/loop.md "Tip verify — one writer per branch, absorption at the
    // merge": the worktree read rides the same write. Everything that could
    // still dirty it — the agent, the tip-verify soft reset, an afterCommit
    // revert — ran inside `runAttempt` above; the cherry-pick and afterMerge
    // stages below touch trunk, not here.
    await appendInvocationRow(leg.flumeDir, phase.name, {
      promptPath: attempt.termination.promptPath,
      ...(attempt.termination.usage ?? {}),
      uncommittedTracked: await git.trackedModifications(wt.path),
    });
  }
  if (attempt.tipMoved) {
    mergeOutcomes.push({
      outcome: "dropped-work",
      ...(attempt.spanBase ? { baseSha: attempt.spanBase } : {}),
      ...(attempt.headSha ? { headSha: attempt.headSha } : {}),
    });
  }
  if (attempt.gateFailure) gateFailures.push(attempt.gateFailure);
  if (attempt.noCommit === "gate-revert") {
    // The span the revert just dropped — recorded here because
    // `dropLastCommit` has already moved the branch off it and
    // teardown deletes the branch entirely. The objects survive in
    // the shared store until gc, so these two shas are what makes
    // the work re-cherry-pickable without paying the agent again.
    mergeOutcomes.push({
      outcome: "afterCommit-reverted",
      ...(attempt.footprint && attempt.footprint.length > 0
        ? { footprint: attempt.footprint }
        : {}),
      ...(attempt.spanBase ? { baseSha: attempt.spanBase } : {}),
      ...(attempt.headSha ? { headSha: attempt.headSha } : {}),
    });
  }

  if (attempt.committed) {
    // spec/loop.md "The ship lock and the worktree lock — sibling ticks take
    // turns at git": a singleton's merge span is the wave's over a batch of
    // one — the pick onto trunk, the `afterMerge` judges over the merged
    // tree, and the revert that drops it again. No ledger rewrite rides it
    // (a singleton ships no queue entry), so the span closes where the
    // afterMerge stage does. A sibling tick holding the lock is waited on,
    // never refused (`spec/loop.md`, *Tip verify — one writer per branch,
    // absorption at the merge*).
    //
    // spec/loop.md "The tick verdict — one facts artifact": the merge row's
    // milliseconds are this whole span — the lock a sibling may still hold,
    // the pick, the afterMerge gates, and the revert that may follow — with
    // the gate rows beside it as its breakdown. No `entryTag`: a singleton
    // phase carries no entry, exactly as its merge-outcome row carries none.
    const mergeElapsed = startTiming();
    const shipLock = await git.acquireShipLock(repoRoot, leg.log);
    try {
      // Narrowed off `attempt.committed`: a committed attempt always names
      // the span it produced.
      const spanBase = attempt.spanBase;
      const spanHead = attempt.headSha;
      const carried = await carryMergeSpan({
        leg,
        phase,
        base: spanBase,
        head: spanHead,
        // No `entry` and so no `steps`, and the phase-keyed `ref`: a
        // singleton is a wave of one keyed on the phase name, so the gates
        // read a span with neither half of an assignment
        // (`GateContext.steps`, `src/Gate.ts`) and the record lands in the
        // phase's own slot (spec/worktrees.md "Singleton runs in a
        // worktree").
        ref,
        checkpoint,
        onGateRow: (row, ms) => {
          gateResults.push(row);
          timings.push({ kind: "gate", gate: row.gate, ms });
        },
        // This leg's own vocabulary: the phase names the span, and a refusal
        // leaves a commit on a worktree branch rather than an entry in a
        // queue, because a singleton has no entry to report on at all.
        narrate: {
          tipClaimed: (pid) =>
            `[flume] ${phase.name}: tip claimed by pid ${pid}; refusing to cherry-pick; commit stays on the worktree branch, retried next tick`,
          pickFailed: (message) =>
            `[flume] cherry-pick failed for ${phase.name}: ${message}; commit stays on the worktree branch, retried next tick`,
          absorbed: (shas) =>
            `[flume] ${phase.name}: trunk already held ${shas.map((sha) => sha.slice(0, 8)).join(", ")} of ${spanBase.slice(0, 8)}..${spanHead.slice(0, 8)}; absorbed, not a conflict`,
          gateFailed: (gate) =>
            `[flume] afterMerge gate '${gate}' failed for ${phase.name}; reverting`,
          revertRefused: ({ mergedSha, landedOnSha, refusal }) =>
            `[flume] ${phase.name}: revert of ${mergedSha.slice(0, 8)} back to ${landedOnSha.slice(0, 8)} refused (${refusal}); commit stays on trunk, left for the operator`,
          merged: (mergedSha, landedOnSha) =>
            mergedSha === landedOnSha
              ? `[flume] ${phase.name}: trunk already holds the whole span ${spanBase.slice(0, 8)}..${spanHead.slice(0, 8)}; merged with no commit to add`
              : `[flume] cherry-picked ${phase.name} → ${mergedSha.slice(0, 8)}`,
        },
      });
      if (carried.fate === "tip-moved") {
        // Refused before anything reached trunk, so this row is the whole
        // recovery handle — teardown below deletes the branch, and the commit
        // objects outlive it ({@link TickVerdictMergeOutcome.headSha}).
        // `committed` stays false.
        tipMoved = true;
        mergeOutcomes.push({
          outcome: carried.fate,
          baseSha: spanBase,
          headSha: spanHead,
        });
      } else if (carried.fate === "cherry-pick-conflict") {
        // No footprint on the row, though the carry captured one: the only
        // reader of a footprint is the ledger rewrite keying them by tag
        // (`commitPendingUpdate`, `src/pendingLedger.ts`), and this row has no
        // tag to key one under.
        mergeFailure = carried.failure;
        mergeOutcomes.push({
          outcome: carried.fate,
          baseSha: spanBase,
          headSha: spanHead,
        });
      } else if (
        carried.fate === "afterMerge-reverted" ||
        carried.fate === "afterMerge-revert-refused"
      ) {
        // Unblamed, both of them: a singleton has no entry to quarantine, so
        // the records fall to the consecutive-failure backstop alone — the
        // shape every failure this leg records already takes (`GateFailure`,
        // `src/tickVerdict.ts`).
        noCommit = "gate-revert";
        gateFailures.push(carried.gateFailure);
        if (carried.fate === "afterMerge-revert-refused")
          gateFailures.push(carried.failure);
        // The span that reached trunk, whether the revert landed or was
        // refused. Its base is the tip the pick landed onto, not the span's own
        // base — `headSha` names the trunk-side commit, and a span row's two
        // shas always bound the same range.
        mergeOutcomes.push({
          outcome: carried.fate,
          footprint: carried.touchedPaths,
          baseSha: carried.landedOnSha,
          headSha: carried.mergedSha,
        });
      } else {
        // Trunk holding the whole span leaves the pick nothing to add, and the
        // span is merged all the same (spec/loop.md "Tip verify — one writer
        // per branch, absorption at the merge"). `committed` and `commitSha`
        // stay unset there — naming the tip it landed on as this tick's commit
        // would report a commit it never made — and no merge failure is
        // recorded either way: the merge row's equal shas are the whole fact,
        // and nothing counts this tick as errored.
        if (carried.mergedSha !== carried.landedOnSha) {
          committed = true;
          commitSha = carried.mergedSha;
        }
        mergeOutcomes.push({
          outcome: carried.fate,
          baseSha: carried.landedOnSha,
          headSha: carried.mergedSha,
        });
        // Nothing failed, so the slot clears exactly as on a clean ship: the
        // next tick starts with no stale prior-attempt signal.
        await leg.attempts.clear(ref);
      }
    } finally {
      shipLock.release();
      // Every way out of the span — shipped, reverted, refused, or thrown —
      // is a merge that happened and cost what it cost.
      timings.push({ kind: "merge", ms: mergeElapsed() });
    }
  }

  await tearDownWorktree();

  const pendingAfterSingleton = await readPendingTolerant(leg);
  // A second selection over a second world: this tick may have committed,
  // and it may have left a record of its own. Both facts are re-read, so a
  // chain's refusal judges the tree the handoff is about to route in rather
  // than the one this tick opened on — and the record set it was judged
  // against rides the result below, one read serving both.
  const priorAttemptsAfter = await leg.attempts.readAll();
  const postSelection = pickableSelection({
    pending: pendingAfterSingleton,
    // Re-read with the queue, not the opening map: this tick may have filed
    // an entry of its own, and the order the handoff reads is the one the
    // next tick's selection will take.
    filingTimes: await readLedgerFilingTimes(leg),
    isForkResolved,
    capabilities,
    ...(quarantinedSlugs !== undefined ? { quarantinedSlugs } : {}),
    // Re-read with the rest: a build wave that shipped while this tick ran
    // has dropped its claims, and an entry this tick's handoff routes on is
    // free again.
    claimedSlugs: await leg.claims.readLive(),
    refuses: bindEntryRefusal(chain, {
      priorAttempts: priorAttemptsAfter,
      headSha: await git.revParse(repoRoot),
    }),
    // Sequenced like the opening read: the set a handoff routes on is the
    // one the next tick's selection will take, so it is served in the order
    // that selection will serve it.
    order: chain.order,
    inFlight: [],
  });
  return {
    result: {
      phaseName: phase.name,
      committed,
      ...(commitSha ? { commitSha } : {}),
      gateResults,
      pendingAfter: pendingAfterSingleton,
      pickableAfter: postSelection.pickable,
      // Paired with the set above, not with the tick's opening one: a
      // handoff routes on what is pickable now.
      refusedTags: postSelection.refusedTags,
      claimedTags: postSelection.claimedTags,
      // One read, two readers: the map the refusal above was judged against
      // is the map the handoff is handed.
      priorAttempts: priorAttemptsAfter,
      flumeDir: leg.flumeDir,
      configDir: leg.configDir,
      ...(preWtHead ? { baseSha: preWtHead } : {}),
      shippedTags: [],
      revertedTags: [],
      ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
      ...(queueParseFailure ? { queueParseFailure } : {}),
    },
    ...(noCommit ? { noCommit } : {}),
    ...(tipMoved ? { tipMoved } : {}),
    ...(checkpoint.sha ? { bystanderCheckpointSha: checkpoint.sha } : {}),
    ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
    ...(gateFailures.length > 0 ? { gateFailures } : {}),
    ...(attempt.renderFailure
      ? { renderFailures: [attempt.renderFailure] }
      : {}),
    // Unblamed like every other failure a singleton records, and unblamed by
    // its own type besides (`PlatformFailure`, `src/tickVerdict.ts`): the
    // host wall a preempt names is nobody's entry.
    ...(attempt.platformFailure
      ? { platformFailures: [attempt.platformFailure] }
      : {}),
    ...(mergeFailure ? { mergeFailures: [mergeFailure] } : {}),
    mergeOutcomes,
    timings,
  };
}
