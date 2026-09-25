/**
 * The singleton leg of a tick: the whole of what a `singleton` phase does
 * between `tick()`'s chain load and its verdict — the decline consult, the
 * wave-of-one worktree it provisions, the one attempt it makes there, and
 * the merge stage that carries that span back onto trunk.
 *
 * spec/worktrees.md "Singleton runs in a worktree": a singleton is a wave of
 * one keyed on the phase name, so it reaches the same provisioning, attempt
 * and afterMerge machinery a fanout entry does — what differs is the
 * vocabulary it reports in, which has no entry to tag. That difference is
 * this file; the wave's own is `src/waveTick.ts`, and the orchestration
 * around both is `src/Dispatcher.ts`.
 *
 * Everything it reads off the tick that dispatched it arrives as a
 * {@link TickLegContext} (`src/tickLeg.ts`) — no field is re-derived here,
 * and its two queue reads are the ledger's own (`src/pendingLedger.ts`),
 * taken with that context.
 */

import type { Agent } from "./Agent.js";
import { bound } from "./bounds.js";
import { runGate } from "./gateRun.js";
import * as git from "./git.js";
import {
  readPendingForDecision,
  readPendingTolerant,
} from "./pendingLedger.js";
import type { Chain, Phase, TickContext, TickResult } from "./Phase.js";
import type { NoCommitMode } from "./Prompt.js";
import { buildGateRevert, priorAttemptRef } from "./priorAttempts.js";
import { bindEntryRefusal, pickableSelection } from "./selection.js";
import { consultShouldRun, runAttempt } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import { checkMergedTipUnmoved } from "./tipVerify.js";
import {
  gateFailureSignature,
  MAX_FAILURE_SIGNATURE,
  reportedGateRow,
  startTiming,
  type GateFailure,
  type MergeFailure,
  type MergeOutcome,
  type ProvisionFailure,
  type ReportedGateResult,
  type TickVerdictInvocation,
  type TickVerdictMergeOutcome,
  type TickVerdictTiming,
} from "./tickVerdict.js";
import {
  createWorktree,
  teardownWorktreeInstance,
} from "./worktrees.js";

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
  const { pending, queueParseFailure } = await readPendingForDecision(
    leg,
    phase,
  );
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
    isForkResolved,
    capabilities,
    ...(quarantinedSlugs !== undefined ? { quarantinedSlugs } : {}),
    claimedSlugs,
    refuses: bindEntryRefusal(chain, { priorAttempts, headSha: preHead }),
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
      // alone — same shape this leg's gate and merge failures already take.
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
  try {
    await git.pruneWorktrees(repoRoot, leg.log);
  } catch (err) {
    const message = (err as Error).message;
    const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
    provisionFailures.push({ signature, message });
    leg.log.warn(
      `[flume] ${phase.name}: worktree prune failed (${signature}); continuing — worktree creation may still fail`,
    );
  }

  let wt: { path: string; branch: string };
  try {
    wt = await createWorktree(phase.name, preHead, leg.worktreeCtx);
  } catch (err) {
    const message = (err as Error).message;
    const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
    leg.log.warn(
      `[flume] ${phase.name}: worktree provisioning failed (${signature}); no tick this cycle`,
    );
    // Same record on both surfaces: the outcome envelope feeds the verdict
    // and the quarantine accounting, `result` feeds `handoff` — a singleton
    // whose worktree never existed is otherwise indistinguishable there
    // from one that ran and did nothing.
    provisionFailures.push({ signature, message });
    const failures = [...provisionFailures];
    return {
      result: { ...(await noRunResult()), provisionFailures: failures },
      provisionFailures: failures,
    };
  }

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
      const message = (err as Error).message;
      const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
      leg.log.warn(
        `[flume] ${phase.name}: setupWorktree hook failed (${signature}); no tick this cycle`,
      );
      await teardownWorktreeInstance(
    phase,
    chain,
    wt,
    phase.name,
    leg.worktreeCtx,
  );
      provisionFailures.push({ signature, message });
      const failures = [...provisionFailures];
      return {
        result: { ...(await noRunResult()), provisionFailures: failures },
        provisionFailures: failures,
      };
    }
  }

  let committed = false;
  let commitSha: string | undefined;
  // spec/loop.md "Crash equals stop": set the one time this tick's merge
  // stage actually begins a pick range — see the checkpoint call below.
  let bystanderCheckpointSha: string | undefined;
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
  // spec/loop.md "Every agent invocation leaves a usage row": set once the
  // agent actually runs, regardless of what the tick goes on to do with
  // the commit — absent when `shouldRun`/render-refusal skipped the
  // invocation entirely. The row's `uncommittedTracked` is the one field
  // this tick cannot know yet, so it is completed at the teardown site
  // below rather than here.
  let invocationRow:
    | Omit<TickVerdictInvocation, "uncommittedTracked">
    | undefined;
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
  const tipMoved = attempt.tipMoved ?? false;
  // spec/chain.md "What a hook receives": the tip this tick's span
  // branched from — the gates' base, reported on the result as `baseSha`.
  // Unset on a render-refused tick: no span was ever started. (A decline
  // never reaches here — it returns above, before the worktree exists.)
  const preWtHead = attempt.spanBase;
  gateResults.push(...attempt.gateResults);
  timings.push(...attempt.timings);
  if (attempt.termination) {
    invocationRow = {
      promptPath: attempt.termination.promptPath,
      ...(attempt.termination.usage ?? {}),
    };
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
      // Carry the span back onto trunk through the same cherry-pick +
      // afterMerge machinery a one-entry wave uses (spec/worktrees.md
      // "Singleton runs in a worktree"). Trunk may have moved since
      // `preHead` — the operator's checkout is theirs at every moment of
      // a run now that the agent never touches it directly — so this
      // lands onto whatever trunk currently is; only a real conflict
      // refuses.
      //
      // spec/loop.md "Crash equals stop": checkpoint whatever the
      // operator has staged/unstaged on the primary checkout before
      // this tick's one pick range begins — recoverable from the tick
      // verdict alone even if the cherry-pick below conflicts and its
      // `--abort` (now guarded, but still a reset) or a later gate
      // revert disturbs it.
      bystanderCheckpointSha = await git.checkpointBystanderState(repoRoot);
      const preCherry = await git.revParse(repoRoot);
      try {
        await git.cherryPickRange(repoRoot, spanBase, spanHead);
      } catch (err) {
        const message = (err as Error).message;
        leg.log.warn(
          `[flume] cherry-pick failed for ${phase.name}: ${message}; commit stays on the worktree branch, retried next tick`,
        );
        await git.cherryPickAbort(repoRoot);
        mergeFailure = {
          signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
          message,
        };
        mergeOutcomes.push({
          outcome: "cherry-pick-conflict",
          baseSha: spanBase,
          headSha: spanHead,
        });
      }

      if (!mergeFailure) {
        const mergedSha = await git.revParse(repoRoot);
        const afterMergeGates = phase.gates.filter((g) => g.when === "afterMerge");
        const commitTouchedPaths = await git.diffNameOnly(
          repoRoot,
          preCherry,
          mergedSha,
        );
        let entryFailure: ReportedGateResult | undefined;
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
              // The span's base, not `preCherry`: an afterMerge gate
              // reading trunk needs the tip the agent branched from to
              // tell an input this tick ignored from one that landed
              // after it started (spec/chain.md "What a gate receives").
              baseSha: spanBase,
              // The trunk tip the span landed onto — the lower end of the
              // range `commitTouchedPaths` above is diffed over. Trunk may
              // have moved since this tick branched, so it is its own fact
              // and not `spanBase` under another name.
              landedOnSha: preCherry,
              log: (l) => leg.log.info(l),
            },
            leg.gateScope,
          );
          const row = reportedGateRow(gate.name, gr);
          gateResults.push(row);
          timings.push({ kind: "gate", gate: gate.name, ms });
          if (!gr.ok) {
            entryFailure = row;
            break;
          }
        }

        if (entryFailure) {
          leg.log.warn(
            `[flume] afterMerge gate '${entryFailure.gate}' failed for ${phase.name}; reverting`,
          );
          const record = await buildGateRevert(
            "afterMerge",
            entryFailure,
            repoRoot,
            mergedSha,
          );
          await leg.attempts.write(ref, record);
          noCommit = "gate-revert";
          gateFailures.push({
            signature: gateFailureSignature(entryFailure),
            message: entryFailure.message,
          });
          // spec/loop.md "Tip verify — one writer per branch,
          // absorption at the merge", "dropping it must not take
          // bystanders": the primary checkout may hold an operator's
          // uncommitted work, so this reset carries keep-semantics —
          // never --hard — and a textual collision refuses loudly
          // rather than silently discarding either writer's content.
          // Caught here, not propagated: an uncaught throw would crash
          // the tick before this phase's own facts (the gate failure
          // above, teardown, the return below) were ever reached.
          const foreignTip = await checkMergedTipUnmoved(
            repoRoot,
            preCherry,
            mergedSha,
          );
          // The span that reached trunk: `preCherry..mergedSha`, whether
          // the revert below lands or is refused. Its base is the
          // pre-cherry-pick tip, not the span's base — `headSha` names the
          // trunk-side commit, and a span row's two shas always bound the
          // same range.
          let mergeFate: MergeOutcome = "afterMerge-reverted";
          if (foreignTip) {
            leg.log.warn(
              `[flume] ${phase.name}: revert of ${mergedSha.slice(0, 8)} refused (${foreignTip}); commit stays on trunk, left for the operator`,
            );
            mergeFate = "afterMerge-revert-refused";
            gateFailures.push({
              signature: bound(foreignTip.trim(), MAX_FAILURE_SIGNATURE),
              message: foreignTip,
            });
          } else {
            try {
              await git.resetKeepTo(repoRoot, preCherry);
            } catch (err) {
              if (!(err instanceof git.ResetKeepRefusedError)) throw err;
              const message = `${err.message} — afterMerge-failed commit ${mergedSha} stays on trunk, unrevertable to ${preCherry}`;
              leg.log.warn(
                `[flume] ${phase.name}: revert of ${mergedSha.slice(0, 8)} back to ${preCherry.slice(0, 8)} refused (${err.message}); commit stays on trunk, left for the operator`,
              );
              mergeFate = "afterMerge-revert-refused";
              gateFailures.push({
                signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
                message,
              });
            }
          }
          mergeOutcomes.push({
            outcome: mergeFate,
            footprint: commitTouchedPaths,
            baseSha: preCherry,
            headSha: mergedSha,
          });
        } else {
          leg.log.info(
            `[flume] cherry-picked ${phase.name} → ${mergedSha.slice(0, 8)}`,
          );
          committed = true;
          commitSha = mergedSha;
          mergeOutcomes.push({
            outcome: "merged",
            baseSha: preCherry,
            headSha: mergedSha,
          });
          // A clean ship clears the slot so the next tick starts with no
          // stale prior-attempt signal.
          await leg.attempts.clear(ref);
        }
      }
    } finally {
      shipLock.release();
      // Every way out of the span — shipped, reverted, refused, or thrown —
      // is a merge that happened and cost what it cost.
      timings.push({ kind: "merge", ms: mergeElapsed() });
    }
  }

  // spec/loop.md "Tip verify — one writer per branch, absorption at the
  // merge": last read of this worktree before it stops existing.
  // Everything that could still dirty it — the agent, the tip-verify soft
  // reset, an afterCommit revert — is behind us; the cherry-pick and
  // afterMerge stages above ran against trunk, not here.
  const invocation: TickVerdictInvocation | undefined = invocationRow
    ? {
        ...invocationRow,
        uncommittedTracked: await git.trackedModifications(wt.path),
      }
    : undefined;

  await teardownWorktreeInstance(
    phase,
    chain,
    wt,
    phase.name,
    leg.worktreeCtx,
  );

  const pendingAfterSingleton = await readPendingTolerant(leg);
  // A second selection over a second world: this tick may have committed,
  // and it may have left a record of its own. Both facts are re-read, so a
  // chain's refusal judges the tree the handoff is about to route in rather
  // than the one this tick opened on — and the record set it was judged
  // against rides the result below, one read serving both.
  const priorAttemptsAfter = await leg.attempts.readAll();
  const postSelection = pickableSelection({
    pending: pendingAfterSingleton,
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
    ...(bystanderCheckpointSha ? { bystanderCheckpointSha } : {}),
    ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
    ...(gateFailures.length > 0 ? { gateFailures } : {}),
    ...(attempt.renderFailure
      ? { renderFailures: [attempt.renderFailure] }
      : {}),
    ...(mergeFailure ? { mergeFailures: [mergeFailure] } : {}),
    mergeOutcomes,
    ...(invocation ? { invocations: [invocation] } : {}),
    timings,
  };
}
