/**
 * The wave leg of a tick: what a `fanout` phase does between `tick()`'s chain
 * load and its verdict — the slots it opens off the queue, the worktree each
 * provisions for the entry it pulled, the per-entry attempts they run in
 * parallel, the teardown each slot takes as its own attempt ends, and the
 * handoff facts it folds out of all three.
 *
 * The wave is slot-driven, not batch-driven: it opens `maxParallel` slots on
 * the queue's pickable head, and each slot whose span has merged re-reads the
 * queue and pulls the highest-ranked entry it has not attempted that is
 * disjoint from whatever is still in flight (`nextDisjointPick`,
 * `src/selection.ts`), provisioning it alone from trunk as it then stands. It
 * ends when nothing it has not attempted is pickable, or when the run is torn
 * down — the dispatcher's stop signal, or the operator's stop flag read off
 * disk at the same freed slot (`spec/worktrees.md`, *Fanout and worktrees —
 * provisioning, isolation, teardown*; `spec/loop.md`, *Graceful stop — the
 * stop flag*).
 *
 * The stage in the middle that carries each span onto trunk is its own
 * module (`src/waveMerge.ts`), driven from here once per finished attempt —
 * `openWaveMerge`, then `offerAttempt` as each agent returns with a serialized
 * `drainWaiting` behind it, then `closeWaveMerge`. Only the drain touches
 * trunk, under the ship lock it owns, and the ledger commit of what it carried
 * lands inside that same hold; the close is the fold over what the picks
 * observed. A drain may carry several of this tick's waiting spans at once
 * (spec/worktrees.md, *Batched merges*).
 *
 * Its sibling is `src/singletonTick.ts` — the same provisioning, attempt and
 * afterMerge machinery over a wave of one — and the orchestration around
 * both is `src/Dispatcher.ts`. Everything either leg reads off the tick that
 * dispatched it arrives as a {@link TickLegContext} (`src/tickLeg.ts`).
 */

import type { Agent } from "./Agent.js";
import { byFilingThenTag, type FilingTimes } from "./filingOrder.js";
import { existsLoudUnder } from "./fsProbe.js";
import * as git from "./git.js";
import { stopFlagPath } from "./paths.js";
import type { StakedPidClaim } from "./pidClaim.js";
import {
  readLedgerFilingTimes,
  readPendingForDecision,
  readPendingTolerant,
} from "./pendingLedger.js";
import {
  descendantsOf,
  entryExtensionPayload,
  type PendingEntry,
  type QueueParseFailure,
} from "./PendingSchema.js";
import type {
  Chain,
  FanoutEntryOutcome,
  Phase,
  TickContext,
} from "./Phase.js";
import type { PriorAttempt } from "./Prompt.js";
import { priorAttemptRef } from "./priorAttempts.js";
import { mergeBatchWidth } from "./gateBatch.js";
import { blamedOn, nextDisjointPick } from "./selection.js";
import { consultShouldRun, runAttempt } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import {
  stageFailureFacts,
  type PlatformFailure,
  type ProvisionFailure,
  type RenderFailure,
  type StakeLoss,
} from "./tickVerdict.js";
import {
  abandonWaiting,
  closeWaveMerge,
  drainWaiting,
  offerAttempt,
  openWaveMerge,
  waveWallThrow,
  type EntryAttempt,
} from "./waveMerge.js";
import {
  createWorktree,
  teardownWorktreeInstance,
  warnSurvivingWorktrees,
} from "./worktrees.js";
import { thrownMessage } from "./thrown.js";

/**
 * The world one slot's entry was pulled from, as `TickContext` spells it:
 * `pickable`, `claimed` and `priorAttempts` together, never splayed. The three
 * move as one because a leg handed one world's queue beside another world's
 * records is the half-stale shape the live re-reads below exist to prevent,
 * and a signature taking them positionally is where two of them come apart
 * without a typecheck to say so.
 */
interface OfferedFacts {
  readonly pickable: readonly PendingEntry[];
  readonly claimed: readonly string[];
  readonly priorAttempts: ReadonlyMap<string, PriorAttempt>;
}

export async function runFanout(
  leg: TickLegContext,
  phase: Phase,
  agent: Agent,
  chain: Chain,
  forkResolver?: (repoRoot: string) => (slug: string) => boolean,
): Promise<PhaseTickOutcome> {
  const repoRoot = leg.repoRoot;
  const preHead = await git.revParse(repoRoot);
  // spec/pending.md "Queue reads are strict": the same carve-out the singleton
  // decide-read takes. A wave over an unparseable queue has no entry to assign
  // — `pending` is `[]`, so nothing is pickable — and the fact rides the result
  // below, so a `handoff` never reads that empty batch as a drained queue.
  const { pending, filingTimes, queueParseFailure } =
    await readPendingForDecision(leg, phase);
  // spec/loop.md "No false signal": this queue read is the one place the
  // engine learns a tag has left the queue, so it is where records keyed
  // by a departed tag are retired — before selection, so nothing this
  // wave does reads one.
  const clearedPriorAttempts = await leg.attempts.clearStale(pending);

  // Foundations governor: resolve the per-tick fork predicate once, then let
  // it gate selection alongside `blockedBy`. Default: every fork resolved.
  const isForkResolved = forkResolver?.(repoRoot) ?? (() => true);
  // spec/chain.md "What a hook receives": the wave's opening read of
  // prior-attempts/, taken here rather than beside its use because selection
  // needs it first — a chain's declared per-entry refusal is judged against
  // each entry's own record and the tip this wave is about to branch from.
  // It is the opening fill's map and no further: this wave's own merges
  // write and clear records as entries settle (`src/waveMerge.ts`), so a
  // freed slot re-reads the store beside the queue and the tip it re-selects
  // over (`refillRead` below).
  const priorAttempts = await leg.attempts.readAll();
  // spec/loop.md "Repeated identical failures — quarantine, then abort":
  // `quarantinedTags` is reported on the result (below) so a chain's handoff
  // can tell "quarantined open" from "genuinely pickable" without
  // re-deriving it from pendingAfter. `refusedTags` is the same service for
  // the other hold — the chain's own refusal — and rides the result beside
  // it. spec/pending.md "Claims — an entry in flight is left alone": the
  // entries a sibling tick is carrying, read before the selection that must
  // skip them and reported on the result below, so a chain never re-reads
  // the claims directory itself.
  const claimedSlugs = await leg.claims.readLive();
  const {
    pickable,
    quarantinedTags,
    refusedTags,
    claimedTags,
    unresolvedBlockers,
    partitionIgnore,
    maxParallel,
  } = leg.selection({
    chain,
    queue: { pending, filingTimes },
    isForkResolved,
    refusalFacts: { priorAttempts, headSha: preHead },
    claimedSlugs,
    // Nothing of this tick's is in flight yet: the opening fill is what puts
    // the first entries there, so the chain's own sequencing policy is handed
    // the empty set (`OrderContext.inFlight`, `src/Phase.ts`).
    inFlight: [],
  });

  if (pickable.length === 0) {
    // No agent ran — not a no-commit *agent* tick, so nothing to classify.
    leg.log.info(`[flume] ${phase.name}: nothing pickable`);
    return {
      result: {
        phaseName: phase.name,
        committed: false,
        gateResults: [],
        pendingAfter: pending,
        pickableAfter: pickable,
        // The store as this tick leaves it, which on this path is the store
        // as it opened: `clearStale` ran above and nothing since writes a
        // record, because no agent ran.
        priorAttempts,
        flumeDir: leg.flumeDir,
        configDir: leg.configDir,
        shippedTags: [],
        revertedTags: [],
        quarantinedTags,
        refusedTags,
        claimedTags,
        // Reported on the path a queue typo is likeliest to be read from: a
        // wave that found nothing to run may be stuck behind a blocker tag
        // that resolved to nothing, and a handoff that only saw
        // `nothingPickable` would read that as a drained queue.
        unresolvedBlockers,
        nothingPickable: true,
        ...(queueParseFailure ? { queueParseFailure } : {}),
      },
      ...(clearedPriorAttempts.length > 0 ? { clearedPriorAttempts } : {}),
    };
  }

  const waveStart = Date.now();
  leg.log.info(
    `[flume] ${phase.name}: fanout over ${pickable.length} pickable, ${maxParallel} slot(s) wide`,
  );

  // A repo-level provisioning wall (prune itself fails — no single
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
    await git.pruneWorktrees(repoRoot, leg.log);
  } catch (err) {
    const failure = stageFailureFacts(thrownMessage(err));
    provisionFailures.push(failure);
    leg.log.warn(
      `[flume] ${phase.name}: worktree prune failed (${failure.signature}); continuing — per-entry provisioning may still fail`,
    );
  }

  // Every entry this wave provisioned a worktree for. It grows as freed slots
  // refill, so it is not the batch: it is what the wave provisioned by the
  // time it put the work down. The worktree itself is the slot's own — each
  // slot takes down what it created as its own attempt ends (`settleSlot`
  // below), so nothing here is a list a wave-end walk reads back.
  const provisioned: PendingEntry[] = [];
  // What those teardowns came to, folded once for the wave: how many worktrees
  // came down, and the paths that survived even the fallback removal. Reported
  // once below rather than once per worktree — a locked node_modules on one
  // entry shouldn't produce N identical log lines.
  let cleaned = 0;
  const survivingPaths: string[] = [];
  // And every entry this wave selected and then lost the stake race for,
  // reported on the result and the verdict below: the entry reaches no agent
  // and moves no tag list, so without this record the only trace of it is the
  // log line beside the push (`.claude/rules/engineering.md`, *A fact the
  // engine holds is reported, never rediscovered*).
  const stakeLosses: StakeLoss[] = [];
  // And every entry whose render refused before its agent was invoked — an
  // inline-exec span that would not run, or a `shouldRun`/`promptArgs` that
  // threw. The mode folds to one tick-level `noCommit` a shipping sibling
  // erases, so the record under the tag is the only per-entry trace
  // (`RenderFailure`, `src/tickVerdict.ts`). Filled as each attempt returns
  // below, and read by the merge stage's own refusal verdict — which holds
  // this same array and is built where the wave has settled, so a refusal
  // reports the refusals raised behind it as well as before it.
  const renderFailures: RenderFailure[] = [];
  // And every entry whose agent failed for non-work reasons rather than
  // reaching an exit of its own. Same shortfall the array above answers, one
  // stage later and with no blame to carry: the preempt class reaches the
  // entry's prior-attempt slot for the retry's prompt to read, and nothing
  // else on this wave's surfaces states it (`PlatformFailure`,
  // `src/tickVerdict.ts`). Filled and read exactly as the refusals are.
  const platformFailures: PlatformFailure[] = [];

  // Carry each entry's span onto trunk as that entry's own agent finishes:
  // the merge/gate/revert stage, one span at a time under its own ship lock
  // (`src/waveMerge.ts`). A wave never waits on its slowest agent to merge
  // its fastest (`spec/worktrees.md`, *Fanout and worktrees — provisioning,
  // isolation, teardown*), so the stage is opened here and fed per finished
  // attempt rather than called once over a settled batch.
  const merge = openWaveMerge({
    leg,
    phase,
    provisioned,
    partitionIgnore,
    // spec/worktrees.md "Batched merges": how many of this wave's finished
    // spans one merge may carry, read off the tick's own resolved chain through
    // the one derivation of it (`mergeBatchWidth`, `src/gateBatch.ts`) — the
    // chain's `mergeBatch` and every `afterMerge` gate's own declaration have
    // to agree before it is above one.
    mergeWidth: mergeBatchWidth(chain, phase),
    provisionFailures,
    renderFailures,
    platformFailures,
    stakeLosses,
    clearedPriorAttempts,
  });
  // The merges are serialized *in this process* before they reach the lock,
  // because the ship lock is a pid claim: a second acquire from this same
  // process would read its own live pid as a holder and wait on itself
  // forever (`acquireWaitLock`, `src/waitLock.ts`). `mergeTail` is that
  // queue — each attempt joins it the moment its agent returns, so the order
  // spans land is finish order, not batch order. One drain per offered attempt
  // whatever the merge width is: a drain whose spans an earlier batch already
  // carried finds its queue empty and returns (`drainWaiting`,
  // `src/waveMerge.ts`), which is what keeps "every span is carried" true of
  // this chain at any width.
  let mergeTail: Promise<void> = Promise.resolve();
  // The first throw out of a merge, held rather than propagated on the spot.
  // A throw there is the same wall it has always been — it stops the wave
  // carrying any further span — but the siblings still running have to settle
  // before this leg can leave, or their worktrees are torn down under them by
  // nothing. A refused ledger rewrite rides this holder like any other cause:
  // the rewrite is inside the pick's own hold now, so the refusal happens
  // mid-wave, and the verdict naming every pick it landed — and everything the
  // siblings behind it went on to observe — is built at the throw below, where
  // the wave has settled (`waveWallThrow`, `src/waveMerge.ts`).
  let mergeError: unknown;

  // `git worktree add`/`remove` mutate the shared `.git/worktrees/` metadata
  // dir and git is not concurrency-safe there: one slot's create can fail a
  // sibling's mid-validation. So creation is serialized for the wave's whole
  // life, refills included, mirroring the pre-wave `pruneWorktrees` above —
  // and a settling slot's teardown joins the same queue, because `remove`
  // mutates the metadata a sibling's `add` is validating.
  // Its own queue rather than `mergeTail`'s, because the expensive half of
  // provisioning — the chain's `setupWorktree` install — must not hold a
  // finished sibling's span off trunk, and the agent fanout past it stays
  // parallel: neither touches `.git/worktrees/`.
  let provisionTail: Promise<void> = Promise.resolve();

  // The entries whose span this wave is still carrying: provisioning, agent
  // or merge. This is what a freed slot's pick is made disjoint from
  // (`nextDisjointPick`, `src/selection.ts`) — not the batch, which says
  // nothing about which siblings are still open at the moment a slot frees.
  const inFlight = new Map<string, PendingEntry>();
  // What the next slot picks from: the queue's pickable set in its own order,
  // as of the last read. The wave opens on the selection above and a freed
  // slot re-reads (`refillRead` below) rather than splicing this one down, so
  // an entry filed or re-ranked while the wave ran is pulled at its live rank
  // (`spec/worktrees.md`, *Fanout and worktrees — provisioning, isolation,
  // teardown*).
  let candidates: PendingEntry[] = [...pickable];
  // Every entry a slot has pulled, whatever became of it — shipped, reverted,
  // no-commit, declined, provisioning-failed, stake-lost. A re-read offers a
  // no-commit entry again, and a wave that pulled it twice would spend a
  // second agent on the attempt the first one already made, so the skip is
  // stated here rather than left to this wave's own claims, which happen to
  // cover the same set only while the claims directory is readable.
  const attempted = new Set<string>();
  // What `ctx.pickable`/`ctx.claimed`/`ctx.priorAttempts` say for the entry a
  // slot is about to run: the facts the selection that pulled it was taken
  // over, not the wave's opening ones — an entry filed mid-wave is absent
  // from those entirely, and a record a sibling's merge wrote a moment ago is
  // missing from that map (`spec/chain.md`, *What a hook receives*). The three
  // move together, which is the property {@link OfferedFacts} holds.
  let livePickable: readonly PendingEntry[] = pickable;
  // The whole listing the live selection was taken over, not its pickable
  // slice: a `step` is no dispatch unit, so it is absent from every set above
  // and present only here — and the steps of the entry a slot pulls are what
  // its span may ship (`ShipContext.steps`, `src/Phase.ts`). Moved with the
  // triple below for the same reason they move together: an entry pulled
  // after a refill is judged against the queue that refill read.
  let liveQueue: readonly PendingEntry[] = pending;
  // The filing times the live selection ordered that listing by, moved with
  // it: the order a freed slot pulls in is the one the queue it read states,
  // and the wave's own per-entry report is in that same order below.
  let liveFilingTimes: FilingTimes = filingTimes;
  let liveClaimedTags: readonly string[] = claimedTags;
  let livePriorAttempts: ReadonlyMap<string, PriorAttempt> = priorAttempts;
  // The operator's graceful stop, as the last refill read it off disk
  // (`spec/loop.md`, *Graceful stop — the stop flag*). The supervisor reads
  // the same flag through the same probe at its own child boundary; a wave
  // long enough to outlast many merges would otherwise pull new entries for
  // as long as the queue offered them, and the flag would take effect only
  // once the wave it was written during had drained the queue it was written
  // to stop. Read only where the run was told it is supervised — a bare
  // `flume tick` is the operator's own explicit action and ignores the flag,
  // which is the one command an operator has for testing a staged fix before
  // acking the stop.
  let stopFlagSeen = false;
  // A refill read that did not resolve, held as the failure it read rather
  // than a flag beside it: the entries in flight settle and the wave leaves
  // with them, pulling nothing more over a queue it could not read
  // (`.claude/rules/engineering.md`, *Loud or nothing*), and the failure
  // itself rides the result on the field the opening read already reports
  // through (`TickResult.queueParseFailure`) — the wall is the fact of this
  // tick, not a log line a `handoff` cannot reach.
  //
  // This is the arm the phase's own fence admits, so the read handed the
  // failure back; the arm it does not admit throws instead, and leaves this
  // wave past the settled merge stage carrying its verdict, classified as the
  // ledger refusal it is (`waveWallThrow`, `src/waveMerge.ts`).
  let refillParseFailure: QueueParseFailure | undefined;
  // One promise per slot this wave opened, appended to as freed slots refill.
  const slots: Promise<void>[] = [];
  // The first throw out of a slot's own leg — the attempt machinery, not the
  // merge, which `mergeError` above holds. Held for the same reason: the
  // siblings still running settle before this leg leaves, and no freed slot
  // pulls another entry into a wave that is already walled.
  let slotError: unknown;
  // The wave's initial fill cuts every worktree from the tip the tick started
  // on; an entry a freed slot pulls is cut from trunk as it then stands,
  // because a refill cut from the pre-head would re-earn every conflict the
  // merges before it already resolved (`spec/worktrees.md`, *Fanout is the
  // engine's declared navigation carve-out*).
  let initialFill = true;

  // Every attempt this wave handed to an agent — the set the per-entry records
  // below are mapped off, appended to as each agent returns and ordered into
  // the queue's own order there.
  const perEntry: EntryAttempt[] = [];

  /**
   * The carried half of one slot: the worktree it provisions alone, the
   * chain's setup hook for that worktree, the agent, and the merge its span
   * joins. Answers with the worktree it provisioned — what {@link settleSlot}
   * then takes down — or `undefined` when provisioning never reached one.
   *
   * A throw leaves past the settling below, which is what keeps a walled
   * wave's worktree and claim standing for the operator to clear.
   */
  const carrySlot = async (
    entry: PendingEntry,
    steps: readonly PendingEntry[],
    baseRef: () => Promise<string>,
    offered: OfferedFacts,
  ): Promise<{ path: string; branch: string } | undefined> => {
    // A provisioning failure (base read, create, or the chain's hook) is
    // isolated to the entry whose slot hit it — a held/EBUSY worktree dir on
    // one entry must not crash the whole wave when its siblings are perfectly
    // pickable (the ship-detection-declared-files-diff incident: 12/16 ticks
    // burned on one held slug while 6/7 other entries sat pickable). The
    // failed entry stays pending, its slot frees like any other, and the
    // worktree this answers with is the one the slot's own tail takes down.
    let wt: { path: string; branch: string } | undefined;
    const create = provisionTail.then(async () => {
      try {
        const from = await baseRef();
        wt = await createWorktree(entry.tag, from, leg.worktreeCtx);
        provisioned.push(entry);
      } catch (err) {
        const failure = stageFailureFacts(thrownMessage(err));
        provisionFailures.push({ ...blamedOn(entry), ...failure });
        leg.log.warn(
          `[flume] ${phase.name}: worktree provisioning failed for ${entry.tag} (${failure.signature}); entry stays pending, continuing with the remaining batch`,
        );
      }
    });
    provisionTail = create;
    await create;
    if (wt === undefined) return undefined;

    // Optional per-phase setup (e.g. materialize node_modules / .env so gates
    // run). The return value MAY contribute extraEnv that this leg layers
    // onto the agent invocation env (e.g. per-worktree DATABASE_URL from a
    // chain that provisioned an ephemeral DB at setup time).
    //
    // Off the creation queue above, so N slots' hooks still run concurrently.
    // A throw is this entry's provisioning failure: the worktree it already
    // got still exists and still needs teardown, so the slot answers with it
    // for its own tail to take down and `provisioned` keeps the entry; only
    // this entry never reaches the agent.
    let extraEnv: Record<string, string> | undefined;
    if (phase.setupWorktree) {
      try {
        const setup = await phase.setupWorktree({
          worktreePath: wt.path,
          repoRoot,
          worktreeKey: entry.tag,
        });
        if (setup && setup.extraEnv) extraEnv = setup.extraEnv;
      } catch (err) {
        const failure = stageFailureFacts(thrownMessage(err));
        provisionFailures.push({ ...blamedOn(entry), ...failure });
        leg.log.warn(
          `[flume] ${phase.name}: setupWorktree hook failed for ${entry.tag} (${failure.signature}); entry stays pending, continuing with the remaining batch`,
        );
        return wt;
      }
    }

    const r = await runFanoutEntry(leg, {
      phase,
      entry,
      steps,
      wt,
      agent,
      chain,
      extraEnv,
      offered,
    });
    perEntry.push(r);
    if (r.renderFailure) renderFailures.push(r.renderFailure);
    if (r.platformFailure) platformFailures.push(r.platformFailure);
    // Everything this attempt observed away from trunk is folded and its span
    // joins the queue of spans waiting on the ship lock *now*, off the merge
    // queue below: a usage row is paid for as its agent finishes, and a span
    // that is not waiting when the next merge takes the lock cannot be in its
    // batch (spec/worktrees.md, *Batched merges*).
    await offerAttempt(merge, r);
    // A walled wave carries no further span onto trunk — but what the attempts
    // waiting on it observed is still a fact of this tick, and the verdict
    // below is built where every slot has finished, so the facts half of the
    // merge runs either way, naming the spans it will not carry
    // (`abandonWaiting`, `src/waveMerge.ts`).
    const queued = mergeTail.then(() =>
      mergeError === undefined
        ? drainWaiting(merge)
        : Promise.resolve(abandonWaiting(merge)),
    );
    // The tail itself never rejects: a merge that threw must not take the
    // queue down with it, or every sibling behind it would reject with the
    // same error and the wave would report a wall per entry.
    mergeTail = queued.catch((err) => {
      mergeError ??= err;
    });
    await mergeTail;
    return wt;
  };

  /**
   * Whether this wave leaves by throwing: a merge that walled, or a slot's own
   * leg that did. Each is held rather than propagated where it happened, so
   * the siblings still running settle first — and all three readers ask this
   * one predicate: the freed slot that then pulls nothing more
   * ({@link wavePulls}), the settling slot that then leaves its worktree and
   * claim standing ({@link settleSlot}), and the leg's own throw site, which
   * hands both holders to one selection over them
   * (`waveWallThrow`, `src/waveMerge.ts`).
   */
  const waveThrows = (): boolean =>
    mergeError !== undefined || slotError !== undefined;

  /**
   * The tail of a slot whose own attempt has ended: the teardown of the
   * worktree and branch it provisioned, then the release of the claim it
   * staked (`spec/pending.md`, *Claims — an entry in flight is left alone*).
   * Both belong to the slot rather than to the wave, so an entry whose attempt
   * parked is unclaimed while its siblings still run, and the records that
   * claim covers are reachable to the next producer that drains them — not at
   * the end of a wave still refilling hours later.
   *
   * One tail for every way an attempt ends short of a throw — a provisioning
   * failure with no worktree to take down, a hook that declined, a park, a
   * ship — so the wave has one release site per slot and no exit that leaves
   * an entry claimed by a tick that has stopped carrying it. A slot that died
   * with the process leaves a file naming a pid that is gone, and the next
   * selection reclaims it by the same liveness probe every engine lock uses
   * (`spec/loop.md`, *Crash equals stop*).
   *
   * Teardown rides `provisionTail` for the reason creation does — `remove`
   * mutates the metadata a sibling's `add` is validating — and fires before
   * the release, so the claim outlives every trace of the attempt it covered.
   * The chain's `teardownWorktree` hook and the friction harvest run inside it
   * while the worktree path still exists (`teardownWorktreeInstance`,
   * `src/worktrees.ts`).
   *
   * A wave that has hit a wall takes neither half: the throw waiting below is
   * the operator's to clear, and the worktrees and claim files it leaves
   * standing are the accepted cost of refusing rather than proceeding. The
   * claim file is the next selection's liveness probe to reclaim, and needs
   * no repair. The worktree is not the prune's: a prune drops the metadata of
   * a directory that has already gone, and this one is still on disk, so it
   * outlives every per-wave prune until the entry is provisioned again — an
   * entry that leaves the queue first never is. Its remover is the sweep the
   * next `flume loop` start runs (`spec/worktrees.md`, *Startup sweep — a
   * dead wave's residue is removed at the next start*), which takes the
   * directory and the branch it was cut on. A slot that threw never reaches
   * here at all, which is the same verdict by the same reasoning.
   */
  const settleSlot = async (
    entry: PendingEntry,
    claim: StakedPidClaim,
    wt: { path: string; branch: string } | undefined,
  ): Promise<void> => {
    if (waveThrows()) return;
    if (wt !== undefined) {
      const drop = provisionTail.then(() =>
        teardownWorktreeInstance(phase, chain, wt, entry.tag, leg.worktreeCtx),
      );
      // The queue moves on whatever the teardown answered: a throw out of it
      // is this slot's to carry like any other, never a sibling's create
      // rejecting behind it.
      provisionTail = drop.then(
        () => {},
        () => {},
      );
      if (await drop) cleaned++;
      else survivingPaths.push(wt.path);
    }
    claim.release();
  };

  /**
   * One slot's whole life: the claim it stakes, the attempt it carries under
   * that claim ({@link carrySlot}), and the teardown and release its own
   * ending takes ({@link settleSlot}). One spelling for the wave's initial
   * fill and for every refill a freed slot makes — the two differ in the ref
   * the worktree is cut from and in nothing else.
   */
  const runSlot = async (
    entry: PendingEntry,
    steps: readonly PendingEntry[],
    baseRef: () => Promise<string>,
    offered: OfferedFacts,
  ): Promise<void> => {
    // Staked *before* the worktree exists, which is the whole point of the
    // ordering: from here until this wave lets go, the entry is this tick's
    // and a producer that would have re-scoped it is told so. A `held`
    // answer is a sibling that staked between this wave's selection read and
    // now — it carries the entry, this wave does not.
    const claim = await leg.claims.stake(entry.tag);
    if (claim.kind === "held") {
      stakeLosses.push({ tag: entry.tag, by: claim.by });
      leg.log.warn(
        `[flume] ${phase.name}: ${entry.tag} was claimed by pid ${claim.by.pid} after this wave selected it; entry stays pending`,
      );
      return;
    }
    const wt = await carrySlot(entry, steps, baseRef, offered);
    await settleSlot(entry, claim.claim, wt);
  };

  /**
   * Whether this wave still pulls. The teardown signal and the operator's
   * stop flag say the run is ending; a refill read that did not resolve and
   * the two holders {@link waveThrows} reads say the wave has hit a wall.
   * Either way the entries in flight settle and the wave leaves with them.
   */
  const wavePulls = (): boolean =>
    !leg.attemptCtx.stopSignal?.aborted &&
    !stopFlagSeen &&
    refillParseFailure === undefined &&
    !waveThrows();

  /**
   * What a freed slot pulls against, read at the moment it frees: the queue
   * as it then stands, selected under this tick's own holds against the tip
   * and the records as they then stand, minus everything this wave has
   * already attempted. The stop flag is read here too, off the same disk and
   * through the same proven descent the supervisor spends at its child
   * boundary (`existsLoudUnder`, `src/fsProbe.ts`), so a state root a plain
   * file stands at refuses here rather than reading as no stop requested.
   *
   * Asynchronous, so it runs in the settling slot's own continuation rather
   * than inside {@link fillSlots}, which must stay synchronous.
   *
   * The width and the partition's ignore list are the wave's for its whole
   * life (`BatchSelection.maxParallel`, `src/selection.ts`), so what the
   * re-selection is read for is the triple a refilled slot's `TickContext`
   * carries — the pickable set, the claimed tags, and the records the
   * selection was taken over.
   */
  const refillRead = async (): Promise<void> => {
    if (leg.supervisedRun) {
      stopFlagSeen ||= existsLoudUnder(
        "stop flag",
        leg.flumeDir,
        stopFlagPath(leg.flumeDir),
      );
    }
    if (!wavePulls()) return;
    const { pending: live, queueParseFailure: broken } =
      await readPendingForDecision(leg, phase);
    if (broken) {
      refillParseFailure = broken;
      leg.log.warn(
        `[flume] ${phase.name}: the queue did not parse mid-wave; this wave pulls nothing further and the entries in flight finish`,
      );
      return;
    }
    const records = await leg.attempts.readAll();
    // Re-read beside the queue, for the reason the queue is re-read: a
    // sibling's ledger commit may have filed an entry since this wave opened,
    // and the order a freed slot pulls in is the live queue's own.
    liveFilingTimes = await readLedgerFilingTimes(leg);
    const selection = leg.selection({
      chain,
      queue: { pending: live, filingTimes: liveFilingTimes },
      isForkResolved,
      refusalFacts: {
        priorAttempts: records,
        headSha: await git.revParse(repoRoot),
      },
      claimedSlugs: await leg.claims.readLive(),
      // The one selection taken with entries in flight: this wave's siblings
      // are still carrying them, and the order a freed slot pulls in is the
      // chain's policy over exactly that moment (`OrderContext.inFlight`,
      // `src/Phase.ts`). Read here, in the settling slot's own continuation,
      // off the same map `fillSlots` partitions against.
      inFlight: [...inFlight.values()],
    });
    candidates = selection.pickable.filter((e) => !attempted.has(e.tag));
    livePickable = selection.pickable;
    liveQueue = live;
    liveClaimedTags = selection.claimedTags;
    livePriorAttempts = records;
  };

  /**
   * Open every slot this moment leaves room for — the wave's initial fill on
   * the first call, and one freed slot's refill on each call after it.
   *
   * Synchronous by construction: it is called from a settling slot's own
   * continuation, and an `await` inside it would let two calls interleave over
   * `inFlight` and open the same slot twice. The queue re-read a refill picks
   * from ({@link refillRead}) and the tip it branches from are therefore taken
   * outside it — the first in that continuation, the second inside the slot's
   * serialized provisioning.
   */
  const fillSlots = (): void => {
    if (!wavePulls()) return;
    const baseRef: () => Promise<string> = initialFill
      ? () => Promise.resolve(preHead)
      : () => git.revParse(repoRoot);
    initialFill = false;
    while (inFlight.size < maxParallel) {
      const entry = nextDisjointPick({
        candidates,
        inFlight: [...inFlight.values()],
        ignore: partitionIgnore,
        // The live queue, so a refill collides on each candidate's steps too,
        // exactly as the batch partition did.
        listing: liveQueue,
      });
      if (entry === undefined) return;
      candidates = candidates.filter((e) => e.tag !== entry.tag);
      attempted.add(entry.tag);
      inFlight.set(entry.tag, entry);
      const offered = {
        pickable: livePickable,
        claimed: liveClaimedTags,
        priorAttempts: livePriorAttempts,
      };
      // Read here, in the synchronous pull, off the same listing the triple
      // above came from: the merge stage classifies this span against the
      // steps the queue held when the slot took the entry, never against a
      // listing a sibling's refill replaced while the agent ran.
      const steps = descendantsOf(liveQueue, entry.tag);
      slots.push(
        (async () => {
          try {
            await runSlot(entry, steps, baseRef, offered);
          } catch (err) {
            slotError ??= err;
          } finally {
            // The slot is free from here, so the pick below sees this entry
            // out of the in-flight set it must be disjoint from.
            inFlight.delete(entry.tag);
          }
          // Outside the block above and guarded on its own: a refill read is
          // disk, and a throw from it is this wave's wall like any other —
          // never an unhandled rejection out of a slot's tail.
          try {
            await refillRead();
          } catch (err) {
            slotError ??= err;
          }
          fillSlots();
        })(),
      );
    }
  };

  fillSlots();
  // The wave ends when every slot it opened has settled and no settling slot
  // found another disjoint entry to pull — never with its first batch. The
  // walk re-reads `slots.length` each turn because a refill appends to it, and
  // awaiting a slot is what guarantees its own refill is already appended:
  // the append happens in the slot promise's own `finally`.
  for (let i = 0; i < slots.length; i++) await slots[i]!;
  // A walled wave leaves here carried, whatever walled it: every slot has
  // finished behind this line, so the spans this wave already carried onto
  // trunk and the usage row every agent that ran left behind are facts a
  // verdict has to record, and a bare re-throw would take all of them with it.
  // Both holders go to one selection rather than a throw site each: a wave
  // that hit a slot leg's throw *and* a refusing rewrite holds both by the
  // time it gets here, and the class an operator repairs at is the ranking's
  // to state, never the order two `if`s happen to sit in (`waveWallThrow`,
  // `src/waveMerge.ts`). From here it propagates straight to `tick()`'s catch,
  // over the worktree and the claim of every slot that settled behind the
  // wall — `settleSlot` above takes neither half once either holder is set.
  // Surviving worktrees are the accepted cost
  // of refusing rather than proceeding, and they are the next `flume loop`
  // start's sweep to remove (`sweepStaleWorktrees`, `src/worktrees.ts`),
  // which takes the directory and the branch it was cut on — a prune takes
  // neither. Those claim files stay staked for the same reason, and the next
  // selection's liveness probe reclaims them — that reclaim needs no repair.
  if (waveThrows()) throw await waveWallThrow(merge, { mergeError, slotError });

  // Close the stage: the fold over what the picks observed. Each of them
  // already landed its own ledger commit inside its own ship-lock hold, so
  // nothing here touches trunk.
  const mergeStage = closeWaveMerge(merge);

  // What the slots' own teardowns came to (`settleSlot` above), reported once
  // for the wave rather than once per worktree. The denominator is what came
  // down, not what was provisioned: a wave that hit a wall leaves its
  // worktrees standing for the operator, and the two part exactly there.
  const tornDown = cleaned + survivingPaths.length;
  leg.log.info(
    `[flume] ${phase.name}: cleaned ${cleaned}/${tornDown} worktree(s)`,
  );
  warnSurvivingWorktrees(leg.log, phase.name, survivingPaths);

  leg.log.info(
    `[flume] ${phase.name}: wave done in ${Date.now() - waveStart}ms`,
  );

  // spec/chain.md "What a hook receives": one record per entry this wave
  // handed to its agent, before the wave's own shippedTags/revertedTags/
  // noCommit/declined fold below — the clean exit a shipped sibling would
  // otherwise hide from `handoff`. Mapped off `perEntry` itself, which is
  // exactly that set: an entry whose `createWorktree` or `setupWorktree`
  // failed never reached `runFanoutEntry`, and reports on
  // `provisionFailures` under its tag instead of as a record here with
  // every flag false.
  // `mergeOutcome` is read off this wave's own `mergeOutcomes` — the
  // records the verdict persists — never re-derived from the tag lists: a
  // park (`not-shipped`), a cherry-pick conflict, a dropped-work reset and
  // a foreign tip claim are indistinguishable in `committed`/`shipped`/
  // `reverted`, which is the fact a `handoff` would otherwise have to read
  // the verdict log for. `find`, not a filter: at most one record per tag,
  // pinned by "records exactly one mergeOutcomes entry for that tag"
  // (tests/Dispatcher.test.ts).
  // The queue's own order (`byFilingThenTag`, `src/filingOrder.ts`), not the
  // order the agents happened to return in: `perEntry` fills as each slot's
  // agent finishes, and which of two siblings finished first is a fact about
  // the machine, never one a `handoff` should route on. The comparator itself,
  // not a position map off the wave's opening selection: a freed slot pulls
  // from the queue as it then stands, so an entry this wave ran may have no
  // position in the set it opened on. Over the filing times this wave read
  // last, which is the latest read of the history every entry it ran was
  // filed into.
  const queueOrder = byFilingThenTag(liveFilingTimes);
  perEntry.sort((a, b) => queueOrder(a.entry, b.entry));
  const entries: FanoutEntryOutcome[] = perEntry.map((r) => {
    const merge = mergeStage.mergeOutcomes.find(
      (m) => m.entryTag === r.entry.tag,
    );
    return {
      tag: r.entry.tag,
      // The entry's chain-declared fields, off the entry the wave already
      // holds — split by the engine's own core-field vocabulary, never by
      // a consumer diffing against a list it spelled itself.
      extension: entryExtensionPayload(r.entry),
      committed: r.committed,
      shipped: mergeStage.shipped.some((s) => s.tag === r.entry.tag),
      reverted: mergeStage.mergeReverted.some((e) => e.tag === r.entry.tag),
      ...(r.declined ? { declined: true } : {}),
      ...(r.noCommit ? { noCommit: r.noCommit } : {}),
      ...(merge ? { mergeOutcome: merge.outcome } : {}),
    };
  });

  // The queue read that did not resolve, whichever of this wave's two reads
  // hit it: the opening decide-read (which leaves nothing pickable, so that
  // wave returned above) or a freed slot's refill, which walls a wave whose
  // earlier spans are already on trunk. One field either way — a `handoff`
  // asking "did this tick's queue resolve" reads one place
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*).
  const queueFailure = queueParseFailure ?? refillParseFailure;

  const pendingAfterWave = await readPendingTolerant(leg);
  // The post-wave re-derivation is a second selection over a second world:
  // this wave's cherry-picks and ledger commit moved the tip, and its own
  // records are now on disk. Re-read both rather than reusing the wave's
  // opening facts — a refusal judged against the tip this wave started from
  // would hold an entry back over a world that no longer exists.
  const priorAttemptsAfter = await leg.attempts.readAll();
  const postSelection = leg.selection({
    chain,
    // The second world's times too: this wave's own ledger commits retire
    // entries rather than file them, but a sibling's may have filed one while
    // it ran.
    queue: {
      pending: pendingAfterWave,
      filingTimes: await readLedgerFilingTimes(leg),
    },
    isForkResolved,
    refusalFacts: {
      priorAttempts: priorAttemptsAfter,
      headSha: await git.revParse(repoRoot),
    },
    // Re-read like the rest of the second world: this wave dropped its own
    // claims above, and a sibling's may have landed or lifted while it ran.
    claimedSlugs: await leg.claims.readLive(),
    // Every slot settled before this line, so the wave carries nothing: the
    // set a handoff routes on is sequenced as the next tick's opening
    // selection will sequence it.
    inFlight: [],
  });
  return {
    result: {
      phaseName: phase.name,
      committed: mergeStage.committedWave,
      // The set the wave landed, and the one sha `commitSha` has always
      // carried — its last element, computed here rather than kept as a
      // second field on the stage (.claude/rules/engineering.md "Derived
      // state is computed, never restated beside its source"). A wave lands
      // one ledger commit per pick, so the narrow field is the last of N and
      // the set beside it is what a handoff reads to see the rest.
      ...(mergeStage.ledgerShas.length > 0
        ? {
            commitSha: mergeStage.ledgerShas[mergeStage.ledgerShas.length - 1],
            ledgerCommitShas: mergeStage.ledgerShas,
          }
        : {}),
      // The tip this wave's last ship left, gated, read under the hold that
      // landed it (`gatedTip` (`src/waveMerge.ts`)). Beside the two fields
      // above rather than folded into them: those name what this wave
      // contributed to the tip, this names the tip the contributions left
      // standing, and a wave whose last pick failed after its last ship
      // reports two different shas.
      ...(mergeStage.gatedTip ? { gatedTip: mergeStage.gatedTip } : {}),
      gateResults: mergeStage.allGateResults,
      pendingAfter: pendingAfterWave,
      pickableAfter: postSelection.pickable,
      // Paired with the set above, not with the wave's opening one: a
      // handoff routes on what is pickable now.
      refusedTags: postSelection.refusedTags,
      claimedTags: postSelection.claimedTags,
      unresolvedBlockers: postSelection.unresolvedBlockers,
      // One read, two readers: the map the refusal above was judged against
      // is the map the handoff is handed, so a chain asking "which records
      // stand" and the engine's own post-wave verdict cannot disagree.
      priorAttempts: priorAttemptsAfter,
      flumeDir: leg.flumeDir,
      configDir: leg.configDir,
      // The tip this wave's initial fill was provisioned from — the
      // wave-level answer to "what could this tick not have seen". An entry
      // a freed slot pulled branched from trunk as it then stood, and so
      // does a base a `setupWorktree` hook moved by committing; either way
      // the per-entry number is on that entry's own ShipContext.
      baseSha: preHead,
      ...(entries.length > 0 ? { entries } : {}),
      // The entries this wave dropped before an agent ran are nameable
      // from the handoff surface alone — they are absent from `entries`,
      // untouched in `pendingAfter`, and in no tag list.
      ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
      // Named beside them for the same reason, and never among them: a
      // sibling carrying the entry is not a failure this wave can be
      // quarantined for.
      ...(stakeLosses.length > 0 ? { stakeLosses } : {}),
      shippedTags: mergeStage.shipped.map((s) => s.tag),
      revertedTags: mergeStage.mergeReverted.map((e) => e.tag),
      ...(queueFailure ? { queueParseFailure: queueFailure } : {}),
    },
    ...(mergeStage.noCommit ? { noCommit: mergeStage.noCommit } : {}),
    ...(mergeStage.tipMoved ? { tipMoved: mergeStage.tipMoved } : {}),
    ...(mergeStage.declined ? { declined: mergeStage.declined } : {}),
    ...(mergeStage.bystanderCheckpointSha
      ? { bystanderCheckpointSha: mergeStage.bystanderCheckpointSha }
      : {}),
    ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
    ...(stakeLosses.length > 0 ? { stakeLosses } : {}),
    ...(renderFailures.length > 0 ? { renderFailures } : {}),
    ...(platformFailures.length > 0 ? { platformFailures } : {}),
    ...(mergeStage.mergeFailures.length > 0
      ? { mergeFailures: mergeStage.mergeFailures }
      : {}),
    ...(mergeStage.gateFailures.length > 0
      ? { gateFailures: mergeStage.gateFailures }
      : {}),
    ...(mergeStage.shipFailures.length > 0
      ? { shipFailures: mergeStage.shipFailures }
      : {}),
    tags: provisioned.map((e) => e.tag),
    mergeOutcomes: mergeStage.mergeOutcomes,
    timings: mergeStage.timings,
    ...(clearedPriorAttempts.length > 0 ? { clearedPriorAttempts } : {}),
  };
}

/**
 * One provisioned entry's leg of a wave: the `shouldRun` consult this
 * concurrency takes per entry, then the attempt every concurrency makes
 * ({@link runAttempt}, `src/tickAttempt.ts`), reported in the vocabulary the wave's
 * merge loop reads.
 */
async function runFanoutEntry(
  leg: TickLegContext,
  opts: {
    phase: Phase;
    entry: PendingEntry;
    /** The entry's steps, as the listing this slot pulled from held them. */
    steps: readonly PendingEntry[];
    /** The worktree this entry's slot provisioned and set up. */
    wt: { path: string; branch: string };
    agent: Agent;
    chain: Chain;
    /** What the chain's `setupWorktree` hook layered onto this entry's env. */
    extraEnv?: Record<string, string> | undefined;
    /** Handed to the `TickContext` below whole, the one bundle the slot holds. */
    offered: OfferedFacts;
  },
): Promise<EntryAttempt> {
  const { phase, entry, steps, wt, agent, chain, extraEnv, offered } = opts;
  // The prior-attempt record lives at the repo root (not this fresh
  // worktree), keyed by the entry tag — so a reverted attempt's record
  // survives into the next tick's brand-new worktree.
  const ref = priorAttemptRef(phase, entry);
  const site = { entry, steps, worktreePath: wt.path, branch: wt.branch };

  const ctx: TickContext = {
    cwd: wt.path,
    flumeDir: leg.flumeDir,
    stateRootRel: leg.stateRootRel,
    assignedEntry: entry,
    // The listing this slot's span may ship, reported to the hooks as well as
    // to the render and the write guard: a `promptArgs` naming the steps a
    // session may finish reads them here rather than off the ledger the
    // selection already parsed.
    assignedSteps: steps,
    // The bundle through, not unpacked: these are the three fields
    // {@link OfferedFacts} is named off, so a spread is the whole hand-over.
    ...offered,
  };

  // Same seam as the singleton callsite, scoped to this entry — sees the
  // same ctx `promptArgs` sees, and answers a throw through the same guard
  // (spec/chain.md, "What a hook receives"). Taken here rather than before
  // provisioning because that ctx names this entry's own worktree as its
  // `cwd`, and nothing names it until the slot that pulled the entry has
  // provisioned it. A decline costs that one worktree, taken down by the same
  // slot tail every other ending goes through.
  const consult = await consultShouldRun(
    leg.attemptCtx,
    phase,
    ctx,
    ref,
    entry.tag,
  );
  if (consult.verdict === "declined") {
    return {
      ...site,
      committed: false,
      gateResults: [],
      timings: [],
      declined: true,
    };
  }
  if (consult.verdict === "refused") {
    return {
      ...site,
      committed: false,
      gateResults: [],
      timings: [],
      noCommit: "render-refused",
      renderFailure: consult.failure,
    };
  }

  return {
    ...site,
    ...(await runAttempt(leg.attemptCtx, {
      phase,
      chain,
      agent,
      wt,
      ctx,
      ref,
      label: entry.tag,
      entry,
      steps,
      ...(extraEnv !== undefined ? { extraEnv } : {}),
    })),
  };
}

