/**
 * The wave leg of a tick: what a `fanout` phase does between `tick()`'s chain
 * load and its verdict — the slots it opens off the queue, the worktree each
 * provisions for the entry it pulled, the per-entry attempts they run in
 * parallel, the teardown that follows them, and the handoff facts it folds out
 * of all three.
 *
 * The wave is slot-driven, not batch-driven: it opens `maxParallel` slots on
 * the queue's pickable head, and each slot whose span has merged pulls the
 * next pickable entry disjoint from whatever is still in flight
 * (`nextDisjointPick`, `src/selection.ts`) and provisions it alone, from
 * trunk as it then stands. It ends when nothing is pickable — never with its
 * first batch (`spec/worktrees.md`, *Fanout and worktrees — provisioning,
 * isolation, teardown*).
 *
 * The stage in the middle that carries each span onto trunk is its own
 * module (`src/waveMerge.ts`), driven from here once per finished attempt —
 * `openWaveMerge`, then a serialized `mergeAttempt` behind each agent as it
 * returns, then `closeWaveMerge` — each of the latter two under the ship
 * lock it owns.
 *
 * Its sibling is `src/singletonTick.ts` — the same provisioning, attempt and
 * afterMerge machinery over a wave of one — and the orchestration around
 * both is `src/Dispatcher.ts`. Everything either leg reads off the tick that
 * dispatched it arrives as a {@link TickLegContext} (`src/tickLeg.ts`).
 */

import type { Agent } from "./Agent.js";
import { bound } from "./bounds.js";
import * as git from "./git.js";
import type { StakedPidClaim } from "./pidClaim.js";
import {
  readPendingForDecision,
  readPendingTolerant,
} from "./pendingLedger.js";
import {
  entryExtensionPayload,
  type PendingEntry,
} from "./PendingSchema.js";
import type {
  Chain,
  FanoutEntryOutcome,
  Phase,
  TickContext,
} from "./Phase.js";
import type { PriorAttempt } from "./Prompt.js";
import { priorAttemptRef } from "./priorAttempts.js";
import { blamedOn, nextDisjointPick } from "./selection.js";
import { consultShouldRun, runAttempt } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import {
  MAX_FAILURE_SIGNATURE,
  type ProvisionFailure,
  type RenderFailure,
  type StakeLoss,
} from "./tickVerdict.js";
import {
  closeWaveMerge,
  mergeAttempt,
  openWaveMerge,
  type EntryAttempt,
} from "./waveMerge.js";
import { createWorktree, teardownWorktreeInstance } from "./worktrees.js";

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
  const { pending, queueParseFailure } = await readPendingForDecision(
    leg,
    phase,
  );
  // spec/loop.md "No false signal": this queue read is the one place the
  // engine learns a tag has left the queue, so it is where records keyed
  // by a departed tag are retired — before selection, so nothing this
  // wave does reads one.
  const clearedPriorAttempts = await leg.attempts.clearStale(pending);

  // Foundations governor: resolve the per-tick fork predicate once, then let
  // it gate selection alongside `blockedBy`. Default: every fork resolved.
  const isForkResolved = forkResolver?.(repoRoot) ?? (() => true);
  // spec/chain.md "What a hook receives": one read of prior-attempts/ for
  // the whole wave — every entry's TickContext gets the same map, since
  // the records on disk don't change mid-wave. Read here rather than beside
  // that use because selection needs it first: a chain's declared per-entry
  // refusal is judged against each entry's own record and the tip this wave
  // is about to branch from.
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
    partitionIgnore,
    maxParallel,
  } = leg.selection(
    chain,
    pending,
    isForkResolved,
    { priorAttempts, headSha: preHead },
    claimedSlugs,
  );

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
    const message = (err as Error).message;
    const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
    provisionFailures.push({ signature, message });
    leg.log.warn(
      `[flume] ${phase.name}: worktree prune failed (${signature}); continuing — per-entry provisioning may still fail`,
    );
  }

  // Every worktree this wave created, and the entry each was created for —
  // index-aligned, because the teardown walk below reads them as one list.
  // Both grow as freed slots refill, so neither is the batch: they are what
  // the wave provisioned by the time it put the work down.
  const worktrees: Array<{ path: string; branch: string }> = [];
  const provisioned: PendingEntry[] = [];
  // spec/pending.md "Claims — an entry in flight is left alone": every claim
  // this wave staked, dropped together once its attempts have ended (below).
  const staked: StakedPidClaim[] = [];
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
  // below, and read by the merge stage's own refusal verdict, which holds this
  // same array.
  const renderFailures: RenderFailure[] = [];

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
    provisionFailures,
    renderFailures,
    stakeLosses,
    clearedPriorAttempts,
  });
  // The merges are serialized *in this process* before they reach the lock,
  // because the ship lock is a pid claim: a second acquire from this same
  // process would read its own live pid as a holder and wait on itself
  // forever (`acquireWaitLock`, `src/waitLock.ts`). `mergeTail` is that
  // queue — each attempt joins it the moment its agent returns, so the order
  // spans land is finish order, not batch order.
  let mergeTail: Promise<void> = Promise.resolve();
  // The first throw out of a merge, held rather than propagated on the spot.
  // A throw there is the same wall it has always been — it stops the wave
  // carrying any further span and the ledger rewrite never runs — but the
  // siblings still running have to settle before this leg can leave, or
  // their worktrees are torn down under them by nothing.
  let mergeError: unknown;

  // `git worktree add`/`remove` mutate the shared `.git/worktrees/` metadata
  // dir and git is not concurrency-safe there: one slot's create can fail a
  // sibling's mid-validation. So creation is serialized for the wave's whole
  // life, refills included, mirroring the pre-wave `pruneWorktrees` above.
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
  // Every pickable entry no slot has pulled yet, in the queue's own order.
  const remaining: PendingEntry[] = [...pickable];
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
   * One slot's whole life: the claim it stakes, the worktree it provisions
   * alone, the chain's setup hook for that worktree, the agent, and the merge
   * its span joins. One spelling for the wave's initial fill and for every
   * refill a freed slot makes — the two differ in the ref the worktree is cut
   * from and in nothing else.
   */
  const runSlot = async (
    entry: PendingEntry,
    baseRef: () => Promise<string>,
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
    staked.push(claim.claim);

    // A provisioning failure (base read, create, or the chain's hook) is
    // isolated to the entry whose slot hit it — a held/EBUSY worktree dir on
    // one entry must not crash the whole wave when its siblings are perfectly
    // pickable (the ship-detection-declared-files-diff incident: 12/16 ticks
    // burned on one held slug while 6/7 other entries sat pickable). The
    // failed entry stays pending, its slot frees like any other, and
    // `provisioned`/`worktrees` stay index-aligned for everything downstream.
    let wt: { path: string; branch: string } | undefined;
    const create = provisionTail.then(async () => {
      try {
        const from = await baseRef();
        wt = await createWorktree(entry.tag, from, leg.worktreeCtx);
        worktrees.push(wt);
        provisioned.push(entry);
      } catch (err) {
        const message = (err as Error).message;
        const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
        provisionFailures.push({ ...blamedOn(entry), signature, message });
        leg.log.warn(
          `[flume] ${phase.name}: worktree provisioning failed for ${entry.tag} (${signature}); entry stays pending, continuing with the remaining batch`,
        );
      }
    });
    provisionTail = create;
    await create;
    if (wt === undefined) return;

    // Optional per-phase setup (e.g. materialize node_modules / .env so gates
    // run). The return value MAY contribute extraEnv that this leg layers
    // onto the agent invocation env (e.g. per-worktree DATABASE_URL from a
    // chain that provisioned an ephemeral DB at setup time).
    //
    // Off the creation queue above, so N slots' hooks still run concurrently.
    // A throw is this entry's provisioning failure: the worktree it already
    // got still exists and still needs teardown, so `worktrees`/`provisioned`
    // are untouched; only this entry never reaches the agent.
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
        const message = (err as Error).message;
        const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
        provisionFailures.push({ ...blamedOn(entry), signature, message });
        leg.log.warn(
          `[flume] ${phase.name}: setupWorktree hook failed for ${entry.tag} (${signature}); entry stays pending, continuing with the remaining batch`,
        );
        return;
      }
    }

    const r = await runFanoutEntry(
      leg,
      phase,
      entry,
      wt,
      agent,
      chain,
      extraEnv,
      pickable,
      claimedTags,
      priorAttempts,
    );
    perEntry.push(r);
    if (r.renderFailure) renderFailures.push(r.renderFailure);
    const queued = mergeTail.then(() =>
      mergeError === undefined ? mergeAttempt(merge, r) : undefined,
    );
    // The tail itself never rejects: a merge that threw must not take the
    // queue down with it, or every sibling behind it would reject with the
    // same error and the wave would report a wall per entry.
    mergeTail = queued.catch((err) => {
      mergeError ??= err;
    });
    await mergeTail;
  };

  /**
   * Open every slot this moment leaves room for — the wave's initial fill on
   * the first call, and one freed slot's refill on each call after it.
   *
   * Synchronous by construction: it is called from a settling slot's own
   * continuation, and an `await` inside it would let two calls interleave over
   * `inFlight` and open the same slot twice. The tip a refill branches from is
   * therefore read inside the slot's serialized provisioning, not here.
   */
  const fillSlots = (): void => {
    // A run being torn down provisions nothing further, and neither does a
    // wave that has already hit a wall: the entries still in flight settle
    // and the wave leaves with them.
    if (leg.attemptCtx.stopSignal?.aborted) return;
    if (mergeError !== undefined || slotError !== undefined) return;
    const baseRef: () => Promise<string> = initialFill
      ? () => Promise.resolve(preHead)
      : () => git.revParse(repoRoot);
    initialFill = false;
    while (inFlight.size < maxParallel) {
      const entry = nextDisjointPick({
        candidates: remaining,
        inFlight: [...inFlight.values()],
        ignore: partitionIgnore,
      });
      if (entry === undefined) return;
      remaining.splice(remaining.indexOf(entry), 1);
      inFlight.set(entry.tag, entry);
      slots.push(
        (async () => {
          try {
            await runSlot(entry, baseRef);
          } catch (err) {
            slotError ??= err;
          } finally {
            // The slot is free from here, so the pick below sees this entry
            // out of the in-flight set it must be disjoint from.
            inFlight.delete(entry.tag);
            fillSlots();
          }
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
  if (slotError !== undefined) throw slotError;
  if (mergeError !== undefined) throw mergeError;

  // Close the stage: the pending-ledger rewrite over everything that landed,
  // under the ship lock like each pick was.
  //
  // A `WaveLedgerRefusal` thrown out of it propagates past the worktree
  // cleanup below, straight to `tick()`'s catch: the spans it already landed
  // are on trunk, and the verdict naming them rides the error. Surviving
  // worktrees are the accepted cost of refusing rather than proceeding; the
  // next `pruneWorktrees` call reclaims their metadata once a human has
  // cleared the refusal, and the claims below stay staked for the same reason
  // — the reclaim needs no repair.
  const mergeStage = await closeWaveMerge(merge);

  // Cleanup worktrees. Best-effort teardown fires before git.removeWorktree
  // so chain-provisioned ephemera (per-worktree DB, scratch lease, etc.)
  // releases while the worktree path still exists. Teardown failures are
  // logged but do not block worktree removal — leaks are recoverable, a
  // stuck worktree is not. Friction harvest runs in the same
  // best-effort slot, immediately before removal — the last point the
  // worktree-local mirror is still readable.
  let cleaned = 0;
  // A worktree whose directory survives even the fallback removal is
  // reported once for the whole wave, not once per worktree — a locked
  // node_modules on one entry shouldn't produce N identical log lines.
  const survivingPaths: string[] = [];
  // Serialize teardown for the same reason as setup: N concurrent
  // `git worktree remove --force` calls race the shared `.git/worktrees/`
  // dir. The chain's `teardownWorktree` hook and branch deletion ride the
  // same serial loop — teardown is off the critical path, so a simple
  // sequential walk beats interleaving the git-mutating step out alone.
  for (let i = 0; i < worktrees.length; i++) {
    const wt = worktrees[i]!;
    const tag = provisioned[i]!.tag;
    const ok = await teardownWorktreeInstance(
      phase,
      chain,
      wt,
      tag,
      leg.worktreeCtx,
    );
    if (ok) cleaned++;
    else survivingPaths.push(wt.path);
  }
  leg.log.info(
    `[flume] ${phase.name}: cleaned ${cleaned}/${worktrees.length} worktree(s)`,
  );
  if (survivingPaths.length > 0) {
    leg.log.warn(
      `[flume] ${phase.name}: ${survivingPaths.length} worktree(s) survived removal (fallback exhausted): ${survivingPaths.join(", ")}`,
    );
  }
  // spec/pending.md "Claims — an entry in flight is left alone": every claim
  // this wave staked goes here — with the ship for an entry that shipped,
  // with the teardown above for one that did not, and at the same point for
  // an entry whose provisioning never reached a worktree. One site, so no way
  // out of the wave leaves an entry claimed by a tick that has stopped
  // carrying it; a death anywhere above leaves files naming a pid that is
  // gone, and the next selection reclaims them by its liveness probe
  // (spec/loop.md, *Crash equals stop*). A `WaveLedgerRefusal` thrown past
  // this line leaves them standing for the same reason it leaves worktrees:
  // the refusal is the operator's to clear, and the reclaim needs no repair.
  for (const claim of staked) claim.release();

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
  // The queue's own order (`byQueueOrder`, `src/selection.ts`), not the order
  // the agents happened to return in: `perEntry` fills as each slot's agent
  // finishes, and which of two siblings finished first is a fact about the
  // machine, never one a `handoff` should route on. Every attempt's entry came
  // off `pickable`, which is already in that order.
  const queuePosition = new Map(pickable.map((e, i) => [e.tag, i]));
  perEntry.sort(
    (a, b) =>
      queuePosition.get(a.entry.tag)! - queuePosition.get(b.entry.tag)!,
  );
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

  const pendingAfterWave = await readPendingTolerant(leg);
  // The post-wave re-derivation is a second selection over a second world:
  // this wave's cherry-picks and ledger commit moved the tip, and its own
  // records are now on disk. Re-read both rather than reusing the wave's
  // opening facts — a refusal judged against the tip this wave started from
  // would hold an entry back over a world that no longer exists.
  const priorAttemptsAfter = await leg.attempts.readAll();
  const postSelection = leg.selection(
    chain,
    pendingAfterWave,
    isForkResolved,
    { priorAttempts: priorAttemptsAfter, headSha: await git.revParse(repoRoot) },
    // Re-read like the rest of the second world: this wave dropped its own
    // claims above, and a sibling's may have landed or lifted while it ran.
    await leg.claims.readLive(),
  );
  return {
    result: {
      phaseName: phase.name,
      committed: mergeStage.committedWave,
      ...(mergeStage.chorSha ? { commitSha: mergeStage.chorSha } : {}),
      gateResults: mergeStage.allGateResults,
      pendingAfter: pendingAfterWave,
      pickableAfter: postSelection.pickable,
      // Paired with the set above, not with the wave's opening one: a
      // handoff routes on what is pickable now.
      refusedTags: postSelection.refusedTags,
      claimedTags: postSelection.claimedTags,
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
      ...(queueParseFailure ? { queueParseFailure } : {}),
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
    ...(mergeStage.mergeFailures.length > 0
      ? { mergeFailures: mergeStage.mergeFailures }
      : {}),
    ...(mergeStage.gateFailures.length > 0
      ? { gateFailures: mergeStage.gateFailures }
      : {}),
    tags: provisioned.map((e) => e.tag),
    mergeOutcomes: mergeStage.mergeOutcomes,
    invocations: mergeStage.invocations,
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
  phase: Phase,
  entry: PendingEntry,
  wt: { path: string; branch: string },
  agent: Agent,
  chain: Chain,
  extraEnv: Record<string, string> | undefined,
  pickable: readonly PendingEntry[],
  claimed: readonly string[],
  priorAttempts: ReadonlyMap<string, PriorAttempt>,
): Promise<EntryAttempt> {
  // The prior-attempt record lives at the repo root (not this fresh
  // worktree), keyed by the entry tag — so a reverted attempt's record
  // survives into the next tick's brand-new worktree.
  const ref = priorAttemptRef(phase, entry);
  const site = { entry, worktreePath: wt.path, branch: wt.branch };

  const ctx: TickContext = {
    cwd: wt.path,
    flumeDir: leg.flumeDir,
    stateRootRel: leg.stateRootRel,
    assignedEntry: entry,
    pickable,
    claimed,
    priorAttempts,
  };

  // Same seam as the singleton callsite, scoped to this entry — sees the
  // same ctx `promptArgs` sees, and answers a throw through the same guard
  // (spec/chain.md, "What a hook receives"). Taken here rather than before
  // provisioning because a wave's worktrees are created for the batch as a
  // whole, one entry's decline included.
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
      ...(extraEnv !== undefined ? { extraEnv } : {}),
    })),
  };
}

