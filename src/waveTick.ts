/**
 * The wave leg of a tick: what a `fanout` phase does between `tick()`'s chain
 * load and its verdict — the batch it selects off the queue, the worktree it
 * provisions per entry, the per-entry attempts it runs in parallel, the
 * teardown that follows them, and the handoff facts it folds out of all three.
 *
 * The stage in the middle that carries each span onto trunk is its own
 * module: `runWaveMerge` (`src/waveMerge.ts`), called under the ship lock it
 * owns.
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
import { blamedOn } from "./selection.js";
import { consultShouldRun, runAttempt } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import {
  MAX_FAILURE_SIGNATURE,
  type ProvisionFailure,
} from "./tickVerdict.js";
import { runWaveMerge, type EntryAttempt } from "./waveMerge.js";
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
  // spec/loop.md "Repeated identical failures": `quarantinedTags` is
  // reported on the result (below) so a chain's handoff can tell
  // "quarantined open" from "genuinely pickable" without re-deriving it
  // from pendingAfter. `refusedTags` is the same service for the other
  // hold — the chain's own refusal — and rides the result beside it.
  // spec/pending.md "Claims — an entry in flight is left alone": the entries
  // a sibling tick is carrying, read before the selection that must skip
  // them and reported on the result below, so a chain never re-reads the
  // claims directory itself.
  const claimedSlugs = await leg.claims.readLive();
  const {
    pickable,
    quarantinedTags,
    refusedTags,
    claimedTags,
    batches,
    partitionIgnore,
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
  const batch = batches[0]!;
  leg.log.info(
    `[flume] ${phase.name}: fanout ${batch.length}/${pickable.length} pickable in batch 1/${batches.length}`,
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

  // Serialize worktree creation. `createWorktree` internally does
  // `git worktree remove` (stale-slug cleanup) then `git worktree add`,
  // both mutating the shared `.git/worktrees/` metadata dir — and git is
  // NOT concurrency-safe there: a sibling's `--force` remove can fail
  // another's add mid-validation. Run them one at a time, mirroring the
  // already-serialized pre-wave `pruneWorktrees` above. The per-entry
  // agent fanout below stays parallel — that is the expensive work, and
  // it does not touch `.git/worktrees/`.
  //
  // A provisioning failure (sweep or create) is isolated to the
  // entry whose slug hit it — a held/EBUSY worktree dir on one entry must
  // not crash the whole batch when its siblings are perfectly pickable
  // (the ship-detection-declared-files-diff incident: 12/16 ticks burned
  // on one held slug while 6/7 other entries sat pickable). The failed
  // entry stays pending; `provisioned`/`worktrees` stay index-aligned for
  // everything downstream.
  const worktrees: Array<{ path: string; branch: string }> = [];
  const provisioned: PendingEntry[] = [];
  // spec/pending.md "Claims — an entry in flight is left alone": every claim
  // this wave staked, dropped together once its attempts have ended (below).
  const staked: StakedPidClaim[] = [];
  for (const entry of batch) {
    // Staked *before* the worktree exists, which is the whole point of the
    // ordering: from here until this wave lets go, the entry is this tick's
    // and a producer that would have re-scoped it is told so. A `held`
    // answer is a sibling that staked between this wave's selection read and
    // now — it carries the entry, this wave does not.
    const claim = await leg.claims.stake(entry.tag);
    if (claim.kind === "held") {
      leg.log.warn(
        `[flume] ${phase.name}: ${entry.tag} was claimed by pid ${claim.by.pid} after this wave selected it; entry stays pending`,
      );
      continue;
    }
    staked.push(claim.claim);
    try {
      worktrees.push(
        await createWorktree(entry.tag, preHead, leg.worktreeCtx),
      );
      provisioned.push(entry);
    } catch (err) {
      const message = (err as Error).message;
      const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
      provisionFailures.push({ ...blamedOn(entry), signature, message });
      leg.log.warn(
        `[flume] ${phase.name}: worktree provisioning failed for ${entry.tag} (${signature}); entry stays pending, continuing with the remaining batch`,
      );
    }
  }

  // Optional per-phase setup (e.g. symlink node_modules / .env so gates
  // run). The return value MAY contribute extraEnv that this leg
  // layers onto the agent invocation env (e.g. per-worktree DATABASE_URL
  // from a chain that provisioned an ephemeral DB at setup time).
  //
  // Isolated the same way `createWorktree` above isolates a per-entry
  // failure: a hook throw for one entry must not reject the
  // `Promise.all` and crash the whole wave when its siblings' hooks
  // succeeded. The worktree this entry got from `createWorktree` still
  // exists and still needs teardown below, so `worktrees`/`provisioned`
  // stay untouched (and index-aligned to each other) for that loop; only
  // the set of entries handed to the agent excludes this one.
  const extraEnvByIndex: Array<Record<string, string> | undefined> =
    worktrees.map(() => undefined);
  const setupFailedIndices = new Set<number>();
  if (phase.setupWorktree) {
    const setupResults = await Promise.all(
      provisioned.map(async (entry, i) => {
        try {
          return await phase.setupWorktree!({
            worktreePath: worktrees[i]!.path,
            repoRoot,
            worktreeKey: entry.tag,
          });
        } catch (err) {
          const message = (err as Error).message;
          const signature = bound(message.trim(), MAX_FAILURE_SIGNATURE);
          provisionFailures.push({ ...blamedOn(entry), signature, message });
          setupFailedIndices.add(i);
          leg.log.warn(
            `[flume] ${phase.name}: setupWorktree hook failed for ${entry.tag} (${signature}); entry stays pending, continuing with the remaining batch`,
          );
          return undefined;
        }
      }),
    );
    for (let i = 0; i < setupResults.length; i++) {
      const r = setupResults[i];
      if (r && r.extraEnv) extraEnvByIndex[i] = r.extraEnv;
    }
  }

  // Run agent in each worktree concurrently — skipping any entry whose
  // setupWorktree hook threw above. Its worktree/branch still get torn
  // down in the cleanup loop below; it just never reaches the agent or
  // cherry-pick, so it stays pending like any other provisioning failure.
  const perEntry = await Promise.all(
    provisioned
      .map((entry, i) => ({ entry, i }))
      .filter(({ i }) => !setupFailedIndices.has(i))
      .map(({ entry, i }) =>
        runFanoutEntry(
          leg,
          phase,
          entry,
          worktrees[i]!,
          agent,
          chain,
          extraEnvByIndex[i],
          pickable,
          claimedTags,
          priorAttempts,
        ),
      ),
  );

  // Carry each entry's span onto trunk: the serial merge/gate/revert/ledger
  // stage, under its own ship lock (`runWaveMerge`, `src/waveMerge.ts`). The
  // per-entry agent fanout above stays parallel — this stage is the part that
  // touches shared git state, so it runs one span at a time.
  //
  // A `WaveLedgerRefusal` thrown out of it propagates past the worktree
  // cleanup below, straight to `tick()`'s catch: the spans it already landed
  // are on trunk, and the verdict naming them rides the error. Surviving
  // worktrees are the accepted cost of refusing rather than proceeding; the
  // next `pruneWorktrees` call reclaims their metadata once a human has
  // cleared the refusal, and the claims below stay staked for the same reason
  // — the reclaim needs no repair.
  const mergeStage = await runWaveMerge({
    leg,
    phase,
    perEntry,
    provisioned,
    partitionIgnore,
    provisionFailures,
    clearedPriorAttempts,
  });

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
      // The tip every worktree in this wave was provisioned from
      // (`createWorktree(entry.tag, preHead)` above) — the wave-level
      // answer to "what could this tick not have seen". A per-entry base
      // that diverged from it (a `setupWorktree` hook that committed) is
      // on that entry's own ShipContext.
      baseSha: preHead,
      ...(entries.length > 0 ? { entries } : {}),
      // The entries this wave dropped before an agent ran are nameable
      // from the handoff surface alone — they are absent from `entries`,
      // untouched in `pendingAfter`, and in no tag list.
      ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
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
    ...(mergeStage.mergeFailures.length > 0
      ? { mergeFailures: mergeStage.mergeFailures }
      : {}),
    ...(mergeStage.gateFailures.length > 0
      ? { gateFailures: mergeStage.gateFailures }
      : {}),
    tags: provisioned.map((e) => e.tag),
    mergeOutcomes: mergeStage.mergeOutcomes,
    invocations: mergeStage.invocations,
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
  if (consult === "declined") {
    return { ...site, committed: false, gateResults: [], declined: true };
  }
  if (consult === "refused") {
    return {
      ...site,
      committed: false,
      gateResults: [],
      noCommit: "render-refused",
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

