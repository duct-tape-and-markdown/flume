/**
 * The wave leg of a tick: the whole of what a `fanout` phase does between
 * `tick()`'s chain load and its verdict — the batch it selects off the
 * queue, the worktree it provisions per entry, the per-entry attempts it
 * runs in parallel, the merge markers it stakes, the serial cherry-pick and
 * afterMerge stage that carries each span onto trunk, and the call to the
 * pending-ledger rewrite (`src/pendingLedger.ts`) that retires what shipped.
 *
 * Its sibling is `src/singletonTick.ts` — the same provisioning, attempt and
 * afterMerge machinery over a wave of one — and the orchestration around
 * both is `src/Dispatcher.ts`. Everything either leg reads off the tick that
 * dispatched it arrives as a {@link TickLegContext} (`src/tickLeg.ts`).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";

import type { Agent } from "./Agent.js";
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
  readPendingForDecision,
  readPendingTolerant,
  type PendingRewriteResult,
} from "./pendingLedger.js";
import {
  entryExtensionPayload,
  PendingParseFailure,
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
 * Thrown in place of whatever `commitPendingUpdate` (`src/pendingLedger.ts`)
 * refused the wave's ledger rewrite with, once that call is reached inside
 * `runFanout`. By this point the wave's cherry-picks and afterMerge gates
 * already landed `shippedTags` on trunk, so the verdict recording them must
 * survive the throw rather than vanish with it (`spec/loop.md`, "The tick
 * verdict — one facts artifact") — and *which* refusal it was never changes
 * that. The rewrite read that would not parse is one of them; so is the
 * `git commit --only` that fatals on a partial commit under a paused merge
 * or cherry-pick, a named path git finds unchanged, a disk error, a lost
 * `index.lock`. The carry is widened to the call rather than keyed on a
 * cause, because every cause leaves the same tags on trunk.
 *
 * `refusalClass` is that classification, stated here from the `cause` in hand
 * rather than re-read downstream off the refusal's own prose
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). `cause` stays on
 * the error for its message and for anything after the underlying throw
 * itself. `verdict` is what this class exists to carry. A plain
 * `PendingParseFailure` from a decide-read (no agent ran, nothing shipped)
 * reaches `tick()` unwrapped and carries no verdict, same as before.
 *
 * The class is exported no further than `tick()`'s own catch: unlike
 * `PendingParseFailure` itself (part of the gate-authoring API surface,
 * `src/flumeApi.ts`) this is the wave's one internal leg, absent from
 * `src/index.ts` and never something a chain's gate needs to distinguish.
 * {@link LedgerRefusalClass} does ship — it is what the tick outcome reports.
 */
export class WaveLedgerRefusal extends Error {
  readonly verdict: TickVerdict;
  readonly refusalClass: LedgerRefusalClass;
  constructor(cause: unknown, verdict: TickVerdict) {
    super(refusalMessage(cause), { cause });
    this.name = "WaveLedgerRefusal";
    this.verdict = verdict;
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
  const { pickable, quarantinedTags, refusedTags, batches, partitionIgnore } =
    leg.selection(chain, pending, isForkResolved, {
      priorAttempts,
      headSha: preHead,
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
        flumeDir: leg.flumeDir,
        configDir: leg.configDir,
        shippedTags: [],
        revertedTags: [],
        quarantinedTags,
        refusedTags,
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
  // footprint included. `commitPendingUpdate` (`src/pendingLedger.ts`) reads
  // a wave's merge-failure footprints straight off these records (the same
  // ones `tick()` persists as `verdict.mergeOutcomes`) rather than a second,
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
      // captured footprint here so the ledger rewrite lands it on
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
    // next `loop` start refuses over it rather than picking
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
      );
      await leg.attempts.write(priorAttemptRef(phase, r.entry), record);
      gateFailures.push({
        // The gate's own attribution decides the entry-scoped half: a gate
        // declaring `blamesSpan: false` leaves the failure unblamed, so the
        // run-scoped quarantine never holds this entry for a wall it was
        // told the entry did not build (spec/chain.md "What a gate
        // returns"). The revert below still happens either way.
        ...(entryFailure.blamesSpan === false ? {} : blamedOn(r.entry)),
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

  // Computed here — ahead of the `commitPendingUpdate` call below — rather than
  // after cleanup where the original single use lived, so a
  // `WaveLedgerRefusal` thrown out of that call can report the same
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
    // The rewrite can refuse, and every way it does propagates past worktree
    // cleanup below, straight to `tick()`'s catch. Its read is the strict
    // `readPending()` (.claude/rules/engineering.md "Loud or nothing"), so a
    // pending.json corrupted by something outside this tick in the window
    // since the wave's decide-read refuses rather than overwriting the file
    // with a rewrite derived from `[]`; and its commit is a `git commit
    // --only` over the one named path, which fatals under a paused merge or
    // cherry-pick in the primary checkout and on a path it finds unchanged.
    // Already-shipped commits stay on trunk (cherry-picked above) in every
    // case. Surviving worktrees are the accepted cost of refusing rather
    // than proceeding; the next `pruneWorktrees` call reclaims their
    // metadata once a human has cleared the refusal.
    let update: PendingRewriteResult;
    try {
      update = await commitPendingUpdate(
        leg,
        shippedTags,
        mergeOutcomes,
        partitionIgnore,
      );
    } catch (err) {
      // spec/loop.md "The tick verdict — one facts artifact": this wave's
      // shipped tags are already real (cherry-picked and afterMerge-gated
      // onto trunk above) — only the ledger rewrite refused. A thrown error
      // is the only channel left once `commitPendingUpdate` never returns,
      // so build the verdict this wave already has the facts for and carry
      // it on the error for `tick()`'s catch to fold in, instead of
      // discarding it the way a plain re-throw would.
      //
      // Every throw out of that call, never the parse failure alone: the
      // tags on trunk are the same facts whichever refusal happened, and
      // keying the carry on a cause is how a `git commit --only` fatal — or
      // a disk error, or an `index.lock` — came to lose a verdict the parse
      // failure's sibling arm kept. `WaveLedgerRefusal` carries the cause
      // for `tick()` to classify.
      const why = refusalMessage(err);
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
            ? `${phase.name} shipped ${shippedTags.join(", ")} — pending-ledger rewrite refused (${why})`
            : `${phase.name}: pending-ledger rewrite refused (${why})`,
        // headSha: the ledger rewrite never reached its own commit, so the
        // tip has not moved past what this wave's cherry-picks already
        // landed — a fresh read rather than reusing `preUpdate` so this
        // stays correct if a future revision moves the read point.
        headSha: await git.revParse(repoRoot),
        at: new Date().toISOString(),
      };
      throw new WaveLedgerRefusal(err, verdict);
    }
    const updSha = update.sha;
    if (updSha !== preUpdate) chorSha = updSha;
    if (update.tipMoved) {
      waveTipMoved = true;
      // The refusal's own disk state, from the call that took it rather than
      // from this site's memory of where its tip check sits: the claim is
      // read before the rewrite is written, so the queue at `update.path` is
      // still the one the call read — the operator has nothing to attribute
      // here, which is the half of this pair the commit refusal below cannot
      // say (`.claude/rules/engineering.md`, *A fact the engine holds is
      // reported, never rediscovered*). The path is the ledger's own
      // spelling, never `pending.json` restated here over a location the
      // chain chose.
      leg.log.warn(
        `[flume] ${phase.name}: tip claimed before the pending-ledger commit; ` +
          `${update.path} is unchanged on disk, no rewrite written — ` +
          `shipped entries already on trunk stay shipped`,
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
  // `commitPendingUpdate`, so `WaveLedgerRefusal`'s partial verdict
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

  const pendingAfterWave = await readPendingTolerant(leg);
  // The post-wave re-derivation is a second selection over a second world:
  // this wave's cherry-picks and ledger commit moved the tip, and its own
  // records are now on disk. Re-read both rather than reusing the wave's
  // opening facts — a refusal judged against the tip this wave started from
  // would hold an entry back over a world that no longer exists.
  const postSelection = leg.selection(chain, pendingAfterWave, isForkResolved, {
    priorAttempts: await leg.attempts.readAll(),
    headSha: await git.revParse(repoRoot),
  });
  return {
    result: {
      phaseName: phase.name,
      committed: committedWave,
      ...(chorSha ? { commitSha: chorSha } : {}),
      gateResults: allGateResults,
      pendingAfter: pendingAfterWave,
      pickableAfter: postSelection.pickable,
      // Paired with the set above, not with the wave's opening one: a
      // handoff routes on what is pickable now.
      refusedTags: postSelection.refusedTags,
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
      ...(queueParseFailure ? { queueParseFailure } : {}),
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
 * that *refused* (`WaveLedgerRefusal`) throws past this call, so its
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
