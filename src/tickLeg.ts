/**
 * The seam between a tick and the leg that runs it: what a leg reads off the
 * dispatcher that resolved the chain, and what it reports back.
 *
 * `tick()` (`src/Dispatcher.ts`) reads the baton, resolves the chain and
 * builds the verdict; the phase's concurrency decides which leg runs the work
 * between those — `runSingleton` (`src/singletonTick.ts`) or `runFanout`
 * (`src/waveTick.ts`). Both legs need the same resolved roots and stores, and
 * both answer in the same shape, so that vocabulary lives in its own file
 * rather than inside whichever leg happens to be read first
 * (`.claude/rules/engineering.md`, *A module is one job*). The ledger reads
 * both legs take are that module's own (`src/pendingLedger.ts`), which the
 * context below extends rather than fronting.
 *
 * A leg takes its state as a {@link TickLegContext} rather than reaching for
 * a field on the dispatcher, the same way one attempt takes an
 * `AttemptContext` (`src/tickAttempt.ts`) — nothing here is re-derived from
 * disk, and no leg can run against a snapshot taken before the tick resolved
 * its chain.
 */

import type { EntryClaimStore } from "./entryClaims.js";
import type { GateRunScope } from "./gateRun.js";
import type { PendingLedgerContext } from "./pendingLedger.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Chain, TickResult } from "./Phase.js";
import type { NoCommitMode } from "./Prompt.js";
import type { PriorAttemptStore } from "./priorAttempts.js";
import type { BatchSelection, EntryRefusalFacts } from "./selection.js";
import type { AttemptContext } from "./tickAttempt.js";
import type {
  GateFailure,
  MergeFailure,
  ProvisionFailure,
  StakeLoss,
  TickVerdict,
  TickVerdictInvocation,
  TickVerdictMergeOutcome,
} from "./tickVerdict.js";
import type { WorktreeContext } from "./worktrees.js";

/** Shared return shape for `runSingleton` and `runFanout` — the facts `tick()` folds into its verdict. */
export type PhaseTickOutcome = {
  result: TickResult;
  noCommit?: NoCommitMode;
  /** Sibling to `noCommit` — see {@link TickVerdict.tipMoved}. */
  tipMoved?: boolean;
  /** Sibling to `noCommit`/`tipMoved` — see {@link TickVerdict.declined}. */
  declined?: boolean;
  /** See {@link TickVerdict.bystanderCheckpointSha}. */
  bystanderCheckpointSha?: string;
  provisionFailures?: ProvisionFailure[];
  /** See {@link TickVerdict.stakeLosses}; fanout only. */
  stakeLosses?: StakeLoss[];
  /** See {@link TickVerdict.mergeFailures}. */
  mergeFailures?: MergeFailure[];
  /** See {@link TickVerdict.gateFailures}. */
  gateFailures?: GateFailure[];
  /** Entry tags this wave provisioned a worktree/agent for (fanout only); absent for a singleton phase. */
  tags?: string[];
  /** Fanout only: each provisioned entry's cherry-pick/merge fate; absent for a singleton phase. */
  mergeOutcomes?: TickVerdictMergeOutcome[];
  /** See {@link TickVerdict.invocations}. */
  invocations?: TickVerdictInvocation[];
  /** See {@link TickVerdict.clearedPriorAttempts}; fanout only. */
  clearedPriorAttempts?: string[];
};

/**
 * What a leg reads off the dispatcher running it: the roots the tick
 * resolved, the stores it records through, the two composed contexts its
 * inner seams take, and the batch selection the dispatcher owns.
 *
 * Extends {@link PendingLedgerContext} (`src/pendingLedger.ts`) rather than
 * respelling its fields, so a leg reads the queue by handing itself to the
 * ledger's own readers — the same six values the dispatcher's preview
 * (`Dispatcher.render`) reads them with. `selection` is the dispatcher's
 * callable, not a copy: a leg that re-derived the batch arithmetic beside it
 * would be a second spelling of a decision that preview already shares with
 * the tick (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*).
 */
export interface TickLegContext extends PendingLedgerContext {
  /** Where the chain config and its prompt files live — reported to every gate. */
  readonly configDir: string;
  /** The mutable-state root: baton, pending ledger, worktrees, prior-attempt records. */
  readonly flumeDir: string;
  /** The state root's escape verdict against the repo root, in git's alphabet. */
  readonly stateRootRel: string | undefined;
  /** Prior-attempt records: read, write, clear, and the revert snapshots. */
  readonly attempts: PriorAttemptStore;
  /**
   * The per-entry claims (`src/entryClaims.ts`): the live set a leg reads
   * before it selects, and the stake a fanout leg takes on each entry it is
   * about to provision.
   */
  readonly claims: EntryClaimStore;
  /** What one agent attempt (`src/tickAttempt.ts`) reads. */
  readonly attemptCtx: AttemptContext;
  /** What the worktree lifecycle (`src/worktrees.ts`) reads. */
  readonly worktreeCtx: WorktreeContext;
  /** What `runGate` (`src/gateRun.ts`) needs from a leg's afterMerge loop. */
  readonly gateScope: GateRunScope;
  /** This run's live quarantine — `DispatcherOptions.quarantinedSlugs`. */
  readonly quarantinedSlugs?: ReadonlySet<string>;
  /**
   * {@link BatchSelection} under this dispatcher's own quarantine and
   * parallelism ceiling.
   *
   * `refusalFacts` and `claimedSlugs` are the leg's, not the dispatcher's:
   * the records, the tip a chain's declared refusal is judged against, and
   * the claims standing on disk are all read *at* the selection, and a
   * pre-wave batch and a post-wave `pickableAfter` are two selections over
   * two worlds.
   */
  selection(
    chain: Chain,
    pending: readonly PendingEntry[],
    isForkResolved: (slug: string) => boolean,
    refusalFacts: EntryRefusalFacts,
    claimedSlugs: ReadonlySet<string>,
  ): BatchSelection;
}
