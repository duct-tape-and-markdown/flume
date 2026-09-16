/**
 * The wave leg of a tick: the whole of what a `fanout` phase does between
 * `tick()`'s chain load and its verdict — the batch it selects off the
 * queue, the worktree it provisions per entry, the per-entry attempts it
 * runs in parallel, the merge markers it stakes, the serial cherry-pick and
 * afterMerge stage that carries each span onto trunk, and the pending-ledger
 * rewrite that retires what shipped.
 *
 * Its sibling is `src/singletonTick.ts` — the same provisioning, attempt and
 * afterMerge machinery over a wave of one — and the orchestration around
 * both is `src/Dispatcher.ts`. Everything either leg reads off the tick that
 * dispatched it arrives as a {@link TickLegContext} (`src/tickLeg.ts`).
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Agent } from "./Agent.js";
import { bound } from "./bounds.js";
import { runGate } from "./gateRun.js";
import * as git from "./git.js";
import type { MergingMarker } from "./mergingMarkers.js";
import {
  matchesAny,
  mergingDir,
  mergingMarkerPath,
  namespacedJoin,
  slugify,
} from "./paths.js";
import {
  entryExtensionPayload,
  PendingParseFailure,
  type ParseError,
  type PendingEntry,
} from "./PendingSchema.js";
import type {
  Chain,
  FanoutEntryOutcome,
  Phase,
  TickContext,
} from "./Phase.js";
import type { NoCommitMode, PriorAttempt } from "./Prompt.js";
import {
  buildGateRevert,
  buildNotShipped,
  priorAttemptRef,
} from "./priorAttempts.js";
import { blamedOn } from "./selection.js";
import {
  consultShouldRun,
  runAttempt,
  type AttemptOutcome,
} from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import { checkMergedTipUnmoved, liveForeignClaimPid } from "./tipVerify.js";
import {
  gateFailureSignature,
  MAX_FAILURE_SIGNATURE,
  reportedGateRow,
  throwFacts,
  type GateFailure,
  type MergeFailure,
  type ProvisionFailure,
  type ReportedGateResult,
  type TickVerdict,
  type TickVerdictInvocation,
  type TickVerdictMergeOutcome,
} from "./tickVerdict.js";
import { createWorktree, teardownWorktreeInstance } from "./worktrees.js";

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
 * One provisioned fanout entry's fate, as the wave's merge loop reads it:
 * the attempt's own outcome plus the entry and worktree facts the merge
 * stage acts on. `declined` is the one fate that never reaches an attempt —
 * `shouldRun` turned this entry away before the render.
 */
type EntryAttempt = AttemptOutcome & {
  entry: PendingEntry;
  /** This entry's worktree, still on disk when the merge loop classifies it — `ShipContext.worktreePath`. */
  worktreePath: string;
  /**
   * This entry's private worktree branch — the ref its span sits on until
   * the merge stage picks it. Carried out of the per-entry leg because the
   * merge marker (spec/loop.md "Crash equals stop") names the branch an
   * interrupted pick left standing, and `perEntry` is filtered out of
   * index-alignment with `worktrees` before the wave loop reads it.
   */
  branch: string;
  /** `phase.shouldRun` declined this entry before the agent was invoked. */
  declined?: boolean;
};

/**
 * Thrown in place of a plain {@link PendingParseFailure} when
 * `commitPendingUpdate`'s rewrite read hits one inside `runFanout` — the
 * ledger-rewrite drift `spec/loop.md` ("The tick verdict") names: by this
 * point the wave's cherry-picks and afterMerge gates already landed
 * `shippedTags` on trunk, so the verdict recording them must survive the
 * throw rather than vanish with it. `tick()`'s `PendingParseFailure` catch
 * checks for this subclass and folds `verdict` into the failed outcome it
 * returns; a plain `PendingParseFailure` from a decide-read (no agent ran,
 * nothing shipped) carries none, same as before. Exported no further than
 * `tick()`'s own catch: unlike `PendingParseFailure` itself (part of the
 * gate-authoring API surface, `src/flumeApi.ts`) this is the one internal leg
 * of that failure class, absent from `src/index.ts` and never something a
 * chain's gate needs to distinguish.
 */
export class WaveLedgerParseFailure extends PendingParseFailure {
  readonly verdict: TickVerdict;
  constructor(errors: readonly ParseError[], verdict: TickVerdict) {
    super(errors);
    this.name = "WaveLedgerParseFailure";
    this.verdict = verdict;
  }
}

/**
 * Wave-level no-commit cause, only meaningful when the wave shipped
 * nothing usable — shared by the wave's normal-completion verdict and by
 * `WaveLedgerParseFailure`'s partial verdict (.claude/rules/engineering.md
 * "Derived state is computed, never restated beside its source"), so a
 * ledger refusal reports the same cause a clean completion would have. The
 * precedence is {@link WAVE_NO_COMMIT_RANK}.
 */
function waveNoCommitCause(
  committedWave: boolean,
  perEntry: readonly { noCommit?: NoCommitMode }[],
  mergeReverted: readonly unknown[],
): NoCommitMode | undefined {
  if (committedWave) return undefined;
  const modes = perEntry.flatMap((r) => (r.noCommit ? [r.noCommit] : []));
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

export async function runFanout(
  leg: TickLegContext,
  phase: Phase,
  agent: Agent,
  chain: Chain,
  forkResolver?: (repoRoot: string) => (slug: string) => boolean,
): Promise<PhaseTickOutcome> {
  const repoRoot = leg.repoRoot;
  const preHead = await git.revParse(repoRoot);
  const pending = await leg.readPending();
  // spec/loop.md "No false signal": this queue read is the one place the
  // engine learns a tag has left the queue, so it is where records keyed
  // by a departed tag are retired — before selection, so nothing this
  // wave does reads one.
  const clearedPriorAttempts = await leg.attempts.clearStale(pending);

  // Foundations governor: resolve the per-tick fork predicate once, then let
  // it gate selection alongside `blockedBy`. Default: every fork resolved.
  const isForkResolved = forkResolver?.(repoRoot) ?? (() => true);
  // spec/loop.md "Repeated identical failures": `quarantinedTags` is
  // reported on the result (below) so a chain's handoff can tell
  // "quarantined open" from "genuinely pickable" without re-deriving it
  // from pendingAfter.
  const { pickable, quarantinedTags, batches, partitionIgnore } =
    leg.selection(chain, pending, isForkResolved);

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
        flumeDir: leg.flumeDir,
        configDir: leg.configDir,
        shippedTags: [],
        revertedTags: [],
        quarantinedTags,
        nothingPickable: true,
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
    await git.pruneWorktrees(repoRoot);
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
  for (const entry of batch) {
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

  // spec/chain.md "What a hook receives": one read of prior-attempts/ for
  // the whole wave — every entry's TickContext gets the same map, since
  // the records on disk don't change mid-wave.
  const priorAttempts = await leg.attempts.readAll();

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
          priorAttempts,
        ),
      ),
  );

  // Cherry-pick winners onto trunk in batch order, gating each at
  // afterMerge individually. The offending entry is the one whose
  // cherry-pick turns an afterMerge gate red — nothing else changed since
  // its pre-cherry-pick trunk — so revert *only* its commit (reset to that
  // point) and leave it pending. The N−1 clean siblings already on trunk
  // stay shipped; later siblings are evaluated against the trunk without
  // the reverted commit. No `reset --hard` back to preHead, so no whole-wave
  // blast radius: one flaky merge-time gate no longer kills N−1 clean commits.
  // Per-entry agent fanout (above) is unchanged — only the serial
  // post-fanout merge/gate/revert granularity changes.
  const afterMergeGates = phase.gates.filter((g) => g.when === "afterMerge");
  const shipped: PendingEntry[] = [];
  const mergeReverted: PendingEntry[] = [];
  // Entries whose afterMerge gate failed AND whose revert-off-trunk was
  // itself refused by a bystander collision (below) — never added to
  // `mergeReverted`, since that array's tags feed `revertedTags` and
  // claiming a revert that never happened would misreport the tree.
  // Counted alongside `mergeReverted` only for `waveNoCommitCause`'s
  // gate-revert classification, which cares that a gate failed, not
  // whether the follow-up reset landed.
  const revertRefused: PendingEntry[] = [];
  const mergeGateResults: ReportedGateResult[] = [];
  // Each provisioned entry's cherry-pick/merge fate, for this
  // wave's TickVerdict — the sole capture of what happened to each entry,
  // footprint included. `commitPendingUpdate` below reads a wave's
  // merge-failure footprints straight off these records (the same ones
  // `tick()` persists as `verdict.mergeOutcomes`) rather than a second,
  // independently-maintained observed-files map. An afterCommit
  // gate-revert or a plain no-commit entry never reaches cherry-pick, so
  // it gets an outcome here only when it carried a captured footprint.
  const mergeOutcomes: TickVerdictMergeOutcome[] = [];
  // Merge-stage and gate-stage
  // failures this wave recorded — sibling accounting to `provisionFailures`
  // above, fed to the same wave-level verdict for superviseLoop's quarantine
  // + consecutive-identical backstop to key off.
  const mergeFailures: MergeFailure[] = [];
  const gateFailures: GateFailure[] = [];
  let waveTipMoved = false;
  // Mirrors `waveTipMoved` — a wave that declined at
  // least one entry sets this even when it also shipped (entries
  // `shouldRun` let through are unaffected by their siblings declining).
  let waveDeclined = false;
  // spec/loop.md "Crash equals stop": checkpointed once, lazily, right
  // before this wave's first cherry-pick range — see the loop below.
  // `checkpointAttempted` (rather than testing the sha itself) so a
  // clean tree at that moment — `checkpointBystanderState` returning
  // `undefined` — is never retried on a later entry in the same wave.
  let checkpointAttempted = false;
  let bystanderCheckpointSha: string | undefined;
  // spec/loop.md "Crash equals stop": the slugs this wave staked a merge
  // marker for, retired together once the ledger rewrite below lands.
  const mergingSlugs = new Set<string>();
  // spec/loop.md "Every agent invocation leaves a usage row": one row per
  // provisioned entry that actually reached `invokeAgent` — a declined or
  // render-refused entry carries no `termination` and gets no row.
  const invocations: TickVerdictInvocation[] = [];

  for (const r of perEntry) {
    if (r.termination) {
      invocations.push({
        entryTag: r.entry.tag,
        promptPath: r.termination.promptPath,
        ...(r.termination.usage ?? {}),
        // spec/loop.md "Tip verify": this entry's worktree is done being
        // written — its agent, its tip-verify soft reset and its
        // afterCommit revert all ran inside `runAttempt`, and the
        // pick below touches trunk alone — but teardown is still a whole
        // wave away, so the set is readable here.
        uncommittedTracked: await git.trackedModifications(r.worktreePath),
      });
    }
    if (r.tipMoved) {
      waveTipMoved = true;
      // Per-entry tip-verify leg: this entry's own ancestry check
      // refused before ever reaching cherry-pick — a real, dropped-work
      // fact, not silence a partial ship summary would otherwise paper
      // over (spec/loop.md "Tip verify"). Distinct from the wave-level
      // `tip-moved` outcome pushed below, which is the shared trunk racing
      // during this wave's own merge step.
      mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "dropped-work",
        ...(r.spanBase ? { baseSha: r.spanBase } : {}),
        ...(r.headSha ? { headSha: r.headSha } : {}),
      });
    }
    if (r.declined) waveDeclined = true;
    if (!r.committed) {
      // An in-worktree afterCommit gate revert never reaches
      // cherry-pick, so it never touches trunk on its own — record its
      // captured footprint here so commitPendingUpdate below lands it on
      // trunk instead of it living only in the gitignored prior-attempt
      // record.
      if (r.footprint && r.footprint.length > 0) {
        mergeOutcomes.push({
          entryTag: r.entry.tag,
          outcome: "afterCommit-reverted",
          footprint: r.footprint,
          ...(r.spanBase ? { baseSha: r.spanBase } : {}),
          ...(r.headSha ? { headSha: r.headSha } : {}),
        });
      }
      if (r.gateFailure) gateFailures.push(r.gateFailure);
      continue;
    }

    // spec/loop.md "Tip verify", "Harness-driven commits carry no
    // expected-tip bookkeeping — the claim refuses, git arbitrates": no
    // sha comparison against a recorded expectation. A live claim on the
    // ref is a concurrent engine instance and refuses exactly as a moved
    // tip used to; absent one, whatever moved trunk was not an engine, and
    // the cherry-pick below lands onto whatever tip is current — git's own
    // conflict detection is the only content arbiter left.
    const foreignClaim = await liveForeignClaimPid(
      repoRoot,
      leg.ownTipClaimPid,
    );
    if (foreignClaim !== null) {
      leg.log.warn(
        `[flume] ${phase.name}: tip claimed by pid ${foreignClaim}; refusing to cherry-pick ${r.entry.tag}, entry stays pending`,
      );
      waveTipMoved = true;
      mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "tip-moved",
        baseSha: r.spanBase,
        headSha: r.headSha,
      });
      continue;
    }
    if (!checkpointAttempted) {
      // spec/loop.md "Crash equals stop": checkpoint whatever the
      // operator has staged/unstaged on the primary checkout before this
      // wave's first pick range begins — once per wave, not once per
      // entry, since a clean checkout stays clean across a wave's own
      // cherry-picks (only a conflict's `--abort`, now guarded, or a
      // gate revert resets anything).
      checkpointAttempted = true;
      bystanderCheckpointSha = await git.checkpointBystanderState(repoRoot);
    }
    const preCherry = await git.revParse(repoRoot);
    // spec/loop.md "Crash equals stop": stake the merge before the pick —
    // a death anywhere past this line leaves the marker standing, and the
    // next `loop` / `job run` start refuses over it rather than picking
    // the same span onto trunk a second time.
    mergingSlugs.add(slugify(r.entry.tag));
    await writeMergingMarker(leg, r.entry, r.branch, r.spanBase);
    try {
      // The per-entry leg's ancestry check already cleared the whole
      // `spanBase..headSha` span as one completed entry — cherry-pick
      // the whole range, in order, not just the newest commit
      // (spec/loop.md "N commits are completion"). Equivalent to a
      // single-sha pick when the span holds exactly one commit.
      await git.cherryPickRange(repoRoot, r.spanBase, r.headSha);
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
      mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "cherry-pick-conflict",
        ...(footprint ? { footprint } : {}),
        baseSha: r.spanBase,
        headSha: r.headSha,
      });
      // A merge-stage failure — always entry-scoped, so
      // superviseLoop's quarantine leg can isolate it exactly like a
      // tagged provisioning failure.
      mergeFailures.push({
        ...blamedOn(r.entry),
        signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
        message,
      });
      continue;
    }
    const mergedSha = await git.revParse(repoRoot);

    // Gate this entry's merged commit. The first failing afterMerge gate
    // attributes the failure to *this* entry — it is the only delta
    // between `preCherry` and `mergedSha`, which now may span more than
    // one cherry-picked commit (spec/loop.md "N commits are completion") —
    // diffed as a range rather than `mergedSha`'s own single-commit show,
    // so an earlier commit in the span isn't missed.
    // Computed once per commit and shared across every gate this loop
    // runs, and reused below as the `afterMerge-reverted` footprint — same
    // dedup as runAfterCommitGates above.
    const commitTouchedPaths = await git.diffNameOnly(
      repoRoot,
      preCherry,
      mergedSha,
    );
    let entryFailure: ReportedGateResult | undefined;
    // `mergeGateResults` is a wave-cumulative accumulator (never reset
    // per entry — `allGateResults` below needs the whole wave's worth).
    // Capture this entry's own starting offset so `ShipContext.gateResults`
    // below can slice out just the results this entry's own afterMerge
    // loop appends, never an earlier sibling's (spec/pending.md "Ship
    // detection trusts the agent's own account").
    const entryMergeGateResultsStart = mergeGateResults.length;
    for (const gate of afterMergeGates) {
      const gr = await runGate(
        gate,
        {
          cwd: repoRoot,
          repoRoot,
          flumeDir: leg.flumeDir,
          stateRootRel: leg.stateRootRel,
          pendingPath: leg.pendingPath,
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
          log: (l) => leg.log.info(l),
        },
        leg.gateScope,
      );
      const row = reportedGateRow(gate.name, gr);
      mergeGateResults.push(row);
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
      const record = await buildGateRevert(
        "afterMerge",
        entryFailure,
        repoRoot,
        mergedSha,
        commitTouchedPaths,
      );
      await leg.attempts.write(priorAttemptRef(phase, r.entry), record);
      gateFailures.push({
        ...blamedOn(r.entry),
        signature: gateFailureSignature(entryFailure),
        message: entryFailure.message,
      });
      // spec/loop.md "Tip verify", "dropping it must not take
      // bystanders": the primary checkout may hold an operator's
      // uncommitted work, so this reset carries keep-semantics — never
      // --hard — and a textual collision refuses loudly rather than
      // silently discarding either writer's content. Caught here, not
      // propagated: an uncaught throw would abort the whole wave loop
      // before `commitPendingUpdate` ever ran, dropping the ledger
      // rewrite for every sibling entry already cherry-picked and shipped
      // ahead of this one.
      const foreignTip = await checkMergedTipUnmoved(
        repoRoot,
        preCherry,
        mergedSha,
      );
      if (foreignTip) {
        leg.log.warn(
          `[flume] ${r.entry.tag}: revert of ${mergedSha.slice(0, 8)} refused (${foreignTip}); commit stays on trunk, left for the operator; other entries continue`,
        );
        revertRefused.push(r.entry);
        mergeOutcomes.push({
          entryTag: r.entry.tag,
          outcome: "afterMerge-revert-refused",
          footprint: commitTouchedPaths,
          baseSha: preCherry,
          headSha: mergedSha,
        });
        gateFailures.push({
          ...blamedOn(r.entry),
          signature: bound(foreignTip.trim(), MAX_FAILURE_SIGNATURE),
          message: foreignTip,
        });
        continue;
      }
      try {
        await git.resetKeepTo(repoRoot, preCherry);
      } catch (err) {
        if (!(err instanceof git.ResetKeepRefusedError)) throw err;
        const message = `${err.message} — afterMerge-failed commit ${mergedSha} stays on trunk, unrevertable to ${preCherry}`;
        leg.log.warn(
          `[flume] ${r.entry.tag}: revert of ${mergedSha.slice(0, 8)} back to ${preCherry.slice(0, 8)} refused (${err.message}); commit stays on trunk, left for the operator; other entries continue`,
        );
        revertRefused.push(r.entry);
        mergeOutcomes.push({
          entryTag: r.entry.tag,
          outcome: "afterMerge-revert-refused",
          footprint: commitTouchedPaths,
          baseSha: preCherry,
          headSha: mergedSha,
        });
        gateFailures.push({
          ...blamedOn(r.entry),
          signature: bound(message.trim(), MAX_FAILURE_SIGNATURE),
          message,
        });
        continue;
      }
      mergeReverted.push(r.entry);
      mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "afterMerge-reverted",
        footprint: commitTouchedPaths,
        baseSha: preCherry,
        headSha: mergedSha,
      });
      continue;
    }

    leg.log.info(
      `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
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
            ...mergeGateResults.slice(entryMergeGateResultsStart),
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
      mergeOutcomes.push({
        entryTag: r.entry.tag,
        outcome: "not-shipped",
        baseSha: preCherry,
        headSha: mergedSha,
        ...(shipThrew === undefined ? {} : { threw: shipThrew }),
      });
      continue;
    }

    shipped.push(r.entry);
    mergeOutcomes.push({
      entryTag: r.entry.tag,
      outcome: "merged",
      baseSha: preCherry,
      headSha: mergedSha,
    });
  }

  // Computed here — ahead of `commitPendingUpdate` below — rather than
  // after cleanup where the original single use lived, so a
  // `WaveLedgerParseFailure` thrown out of that call can report the same
  // gate results and committed-shape a clean completion would (read from
  // two sites, never restated).
  const allGateResults = perEntry
    .flatMap((r) => r.gateResults)
    .concat(mergeGateResults);
  const committedWave = shipped.length > 0;

  // Update pending.json — remove shipped entries, record merge-failure
  // footprints — as one harness commit. `commitPendingUpdate` derives the
  // footprints straight off `mergeOutcomes`, the same records this wave's
  // TickVerdict carries — no separate observed-files bookkeeping here.
  const footprintTags = mergeOutcomes.flatMap((m) =>
    m.entryTag && m.footprint && m.footprint.length > 0 ? [m.entryTag] : [],
  );
  let chorSha: string | undefined;
  if (shipped.length > 0 || footprintTags.length > 0) {
    // Each shipped entry committed clean *and* passed its afterMerge gate
    // — clear any stale prior-attempt slot so its next plan/build cycle
    // starts with no false signal.
    for (const s of shipped) {
      await leg.attempts.clear(priorAttemptRef(phase, s));
    }
    const shippedTags = shipped.map((s) => s.tag);
    // The update can no-op (footprint already recorded, nothing shipped):
    // commitPendingUpdate then returns the pre-existing HEAD, which must
    // not be reported as this wave's commit.
    const preUpdate = await git.revParse(repoRoot);
    // commitPendingUpdate's rewrite read is the strict `readPending()`
    // (.claude/rules/engineering.md "Loud or nothing"): if pending.json was
    // corrupted by something outside this tick in the window since the
    // wave's decide-read, the throw propagates past worktree cleanup
    // below, straight to `tick()`'s PendingParseFailure catch —
    // already-shipped commits stay on trunk (cherry-picked above), but the
    // file itself is never overwritten with a rewrite derived from `[]`.
    // Surviving worktrees are the accepted cost of refusing rather than
    // proceeding; the next `pruneWorktrees` call reclaims their metadata
    // once a human has fixed the file.
    let update: { sha: string; tipMoved: boolean };
    try {
      update = await commitPendingUpdate(
        leg,
        shippedTags,
        mergeOutcomes,
        partitionIgnore,
      );
    } catch (err) {
      if (!(err instanceof PendingParseFailure)) throw err;
      // spec/loop.md "The tick verdict — one facts artifact" drift (b):
      // this wave's shipped tags are already real (cherry-picked and
      // afterMerge-gated onto trunk above) — only the ledger rewrite
      // refused. A thrown error is the only channel left once
      // `commitPendingUpdate` never returns, so build the verdict this
      // wave already has the facts for and carry it on the error for
      // `tick()`'s `PendingParseFailure` catch to fold in, instead of
      // discarding it the way a plain re-throw would.
      const noCommit = waveNoCommitCause(
        committedWave,
        perEntry,
        [...mergeReverted, ...revertRefused],
      );
      const verdict: TickVerdict = {
        phaseName: phase.name,
        tags: provisioned.map((e) => e.tag),
        committed: committedWave,
        ...(noCommit ? { noCommit } : {}),
        ...(waveTipMoved ? { tipMoved: waveTipMoved } : {}),
        ...(waveDeclined ? { declined: waveDeclined } : {}),
        ...(bystanderCheckpointSha ? { bystanderCheckpointSha } : {}),
        gateResults: [...allGateResults],
        shippedTags,
        mergeOutcomes,
        invocations,
        ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
        ...(mergeFailures.length > 0 ? { mergeFailures } : {}),
        ...(gateFailures.length > 0 ? { gateFailures } : {}),
        ...(clearedPriorAttempts.length > 0
          ? { clearedPriorAttempts }
          : {}),
        summary:
          shippedTags.length > 0
            ? `${phase.name} shipped ${shippedTags.join(", ")} — pending-ledger rewrite refused (${err.message})`
            : `${phase.name}: pending-ledger rewrite refused (${err.message})`,
        // headSha: the ledger rewrite never reached its own commit, so the
        // tip has not moved past what this wave's cherry-picks already
        // landed — a fresh read rather than reusing `preUpdate` so this
        // stays correct if a future revision moves the read point.
        headSha: await git.revParse(repoRoot),
        at: new Date().toISOString(),
      };
      throw new WaveLedgerParseFailure(err.errors, verdict);
    }
    const updSha = update.sha;
    if (updSha !== preUpdate) chorSha = updSha;
    if (update.tipMoved) {
      waveTipMoved = true;
      leg.log.warn(
        `[flume] ${phase.name}: tip claimed before the pending-ledger commit; pending.json left untouched — shipped entries already on trunk stay shipped`,
      );
    } else {
      leg.log.info(
        shippedTags.length > 0
          ? updSha === preUpdate
            ? `[flume] shipped ${shippedTags.join(", ")}; pending updated on disk, no chore commit (dock outside repo)`
            : `[flume] ship commit ${updSha.slice(0, 8)}: ${shippedTags.join(", ")}`
          : updSha === preUpdate
            ? `[flume] footprint already recorded, no commit: ${footprintTags.join(", ")}`
            : `[flume] footprint commit ${updSha.slice(0, 8)}: ${footprintTags.join(", ")}`,
      );
    }
  }

  // spec/loop.md "Crash equals stop": every span this wave picked is now
  // accounted for in the queue on disk, so the markers staked above have
  // nothing left to warn the next start about — see `clearMergingMarkers`
  // for why the ledger rewrite, not the verdict write, is the wait point.
  await clearMergingMarkers(leg, mergingSlugs);

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
  leg.log.info(
    `[flume] ${phase.name}: wave done in ${Date.now() - waveStart}ms`,
  );

  // Wave-level no-commit cause, only when the wave shipped nothing usable —
  // `allGateResults`/`committedWave` were already computed above, ahead of
  // `commitPendingUpdate`, so `WaveLedgerParseFailure`'s partial verdict
  // could read them too.
  const waveNoCommit = waveNoCommitCause(
    committedWave,
    perEntry,
    [...mergeReverted, ...revertRefused],
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
    const merge = mergeOutcomes.find((m) => m.entryTag === r.entry.tag);
    return {
      tag: r.entry.tag,
      // The entry's chain-declared fields, off the entry the wave already
      // holds — split by the engine's own core-field vocabulary, never by
      // a consumer diffing against a list it spelled itself.
      extension: entryExtensionPayload(r.entry),
      committed: r.committed,
      shipped: shipped.some((s) => s.tag === r.entry.tag),
      reverted: mergeReverted.some((e) => e.tag === r.entry.tag),
      ...(r.declined ? { declined: true } : {}),
      ...(r.noCommit ? { noCommit: r.noCommit } : {}),
      ...(merge ? { mergeOutcome: merge.outcome } : {}),
    };
  });

  const pendingAfterWave = await leg.readPendingTolerant();
  return {
    result: {
      phaseName: phase.name,
      committed: committedWave,
      ...(chorSha ? { commitSha: chorSha } : {}),
      gateResults: allGateResults,
      pendingAfter: pendingAfterWave,
      pickableAfter: leg.selection(chain, pendingAfterWave, isForkResolved)
        .pickable,
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
      shippedTags: shipped.map((s) => s.tag),
      revertedTags: mergeReverted.map((e) => e.tag),
    },
    ...(waveNoCommit ? { noCommit: waveNoCommit } : {}),
    ...(waveTipMoved ? { tipMoved: waveTipMoved } : {}),
    ...(waveDeclined ? { declined: waveDeclined } : {}),
    ...(bystanderCheckpointSha ? { bystanderCheckpointSha } : {}),
    ...(provisionFailures.length > 0 ? { provisionFailures } : {}),
    ...(mergeFailures.length > 0 ? { mergeFailures } : {}),
    ...(gateFailures.length > 0 ? { gateFailures } : {}),
    tags: provisioned.map((e) => e.tag),
    mergeOutcomes,
    invocations,
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
 * Retire this wave's markers, once the hazard each one names is closed.
 *
 * The wait point is the ship bookkeeping spec/loop.md "Crash equals stop"
 * names — the `pending.json` rewrite above and the prior-attempt record
 * clears that ride with it. The verdict is not part of it and no marker is
 * held for it: `Dispatcher.tick()` never writes the verdict, the CLI's
 * `tick` command does, after `tick()` has returned
 * ({@link writeTickVerdict}). The ledger rewrite is also where the hazard
 * closes — once the queue no longer carries a picked entry as `open`, a
 * crash before the verdict write leaves nothing a second run would pick
 * again, and refusing over it would be a false refusal. A ledger rewrite
 * that *refused* (`WaveLedgerParseFailure`) throws past this call, so its
 * markers survive exactly as a crash's would.
 */
async function clearMergingMarkers(
  leg: TickLegContext,slugs: Iterable<string>): Promise<void> {
  for (const slug of slugs) {
    await rm(namespacedJoin(mergingMarkerPath(leg.flumeDir, slug)), {
      force: true,
    });
  }
}

/**
 * spec/loop.md "Tip verify", "Harness-driven commits carry no expected-tip
 * bookkeeping": no sha comparison — `liveForeignClaimPid`, checked fresh
 * immediately before this function's own harness-driven `commitPaths` call,
 * the wave's other tip-verify site beside `cherryPickRange` (`runFanout`,
 * above). Checked before `writeFile`: a refusal here leaves pending.json
 * untouched on disk rather than a write with no commit behind it. No live
 * claim means the rewrite recommits on whatever tip is current — its
 * content derives from the wave's own outcomes, never from a recorded tip.
 */
async function commitPendingUpdate(
  leg: TickLegContext,
  shippedTags: string[],
  mergeOutcomes: readonly TickVerdictMergeOutcome[],
  partitionIgnore: string[],
): Promise<{ sha: string; tipMoved: boolean }> {
  // Footprint content sources from the wave's own TickVerdict
  // record (mergeOutcomes) rather than a separately maintained map — a
  // view over the same facts `tick()` persists, not a second capture.
  // spec/pending.md "Fanout partition — disjoint touched paths": the
  // footprint recorder filters through the same partitionIgnore list the
  // partition itself reads `touchedPaths` through, so observedFiles never
  // grows with a path the partition would drop anyway.
  // A tagless row is a singleton phase's own span, which keys no ledger
  // entry and never reaches this rewrite — skipped by the same predicate
  // that skips a footprintless row.
  const observed = new Map(
    mergeOutcomes.flatMap((m) =>
      m.entryTag && m.footprint && m.footprint.length > 0
        ? [
            [
              m.entryTag,
              m.footprint.filter((p) => !matchesAny(p, partitionIgnore)),
            ] as [string, string[]],
          ]
        : [],
    ),
  );
  const shipped = new Set(shippedTags);
  // Re-read pending.json fresh, right before deriving the rewrite —
  // NOT the tick-start snapshot the caller read before provisioning
  // worktrees and running agents. A fanout wave's fanned-out agent runs
  // and serial cherry-picks can take long enough for another process
  // (a concurrent tick, a hand fix) to land its own commit to
  // pending.json on trunk in the meantime; deriving from the stale
  // snapshot would blindly overwrite that concurrent write with
  // whatever this wave saw at tick start — silently resurrecting
  // retired fields or reverting fixes in entries this wave never
  // touched. Sourcing the rewrite from the current on-disk state at
  // write time means this wave only ever removes the tags it shipped
  // and touches observedFiles/blockedBy for tags it knows about.
  const current = await leg.readPending();
  // A blockedBy gate naming a tag this wave shipped is resolved HERE,
  // mechanically: this wave just merged and gated that tag, so
  // "did the blocker land" needs no plan tick — the next wave forms
  // without a plan interim. Judgment gates (parked) stay plan's. A
  // multi-parent blockedBy drains one landed tag at a time: the gate
  // only flips to open once every named parent has shipped.
  const after = current
    .filter((e) => !shipped.has(e.tag))
    .map((e) => {
      if (e.gate.kind !== "blockedBy") return e;
      const remainingTags = e.gate.tags.filter((tag) => !shipped.has(tag));
      if (remainingTags.length === e.gate.tags.length) return e;
      return remainingTags.length === 0
        ? { ...e, gate: { kind: "open" as const } }
        : { ...e, gate: { kind: "blockedBy" as const, tags: remainingTags } };
    })
    .map((e) => {
      const obs = observed.get(e.tag);
      if (!obs || obs.length === 0) return e;
      const merged = [...new Set([...(e.observedFiles ?? []), ...obs])];
      return { ...e, observedFiles: merged };
    });
  const serialized = JSON.stringify(after, null, 2) + "\n";
  // A footprint-only update can be a no-op (same collision, same paths,
  // second time around) — committing an unchanged file fails, so skip.
  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  const existing = await readFile(
    namespacedJoin(leg.pendingPath),
    "utf8",
  ).catch(() => "");
  if (serialized === existing) {
    return { sha: await git.revParse(leg.repoRoot), tipMoved: false };
  }
  // A relocated flumeDir puts pendingPath outside the repo, where staging
  // it would fatal — after the entries already merged. An out-of-tree dock
  // is invisible to git by construction, so no chore commit is wanted: the
  // disk write alone carries the auto-unblock and observedFiles forward —
  // computed before the tip check below, which only guards the git-commit
  // path this dock never takes.
  const relocated = leg.isPendingRelocated();

  if (!relocated) {
    // spec/loop.md "Tip verify", re-checked fresh immediately before this
    // method's own commit — the wave's other harness-driven commit besides
    // `cherryPickRange`. Checked before `writeFile`: a refusal here leaves
    // pending.json untouched on disk, never a write with no commit behind
    // it. Shipped entries this wave already cherry-picked stay shipped
    // regardless — only the ledger update itself is refused.
    const foreignClaim = await liveForeignClaimPid(
      leg.repoRoot,
      leg.ownTipClaimPid,
    );
    if (foreignClaim !== null) {
      return {
        sha: await git.revParse(leg.repoRoot),
        tipMoved: true,
      };
    }
  }

  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(dirname(leg.pendingPath)), {
    recursive: true,
  });
  await writeFile(namespacedJoin(leg.pendingPath), serialized, "utf8");
  if (relocated) {
    return { sha: await git.revParse(leg.repoRoot), tipMoved: false };
  }
  // Scoped to pending.json — `git add -A` would sweep up untracked worktree
  // metadata and unrelated user changes into the harness's chore commit.
  const footprintTags = [...observed.keys()];
  const message =
    leg.commitMessage?.(shippedTags, footprintTags) ??
    (shippedTags.length > 0
      ? `chore(flume): ship ${shippedTags.join(", ")}`
      : `chore(flume): record merge-failure footprints for ${footprintTags.join(", ")}`);
  const sha = await git.commitPaths({
    cwd: leg.repoRoot,
    message,
    paths: [leg.pendingPath],
  });
  return { sha, tipMoved: false };
}
