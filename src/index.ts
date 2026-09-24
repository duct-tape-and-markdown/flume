/**
 * Public surface for `flume`. Consumers import from here; package.json's
 * `exports` map restricts resolution to this entry point, so anything not
 * re-exported below is unreachable from outside the package.
 */

export type { Agent, AgentInvocation, AgentResult, AgentUsage } from "./Agent.js";
export {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
  type ClaudeCodeOptions,
  type SessionCaptureOpts,
  type TerminalRendererOpts,
} from "./Agent.js";

// `BatonToken` is what `Baton.token` answers and `Baton.sleepIfUnchanged`
// takes, so a chain holding a phase's token across its own work needs to name
// it from the entry point (`.claude/rules/engineering.md`, *An export earns
// its consumer*).
export { Baton, type BatonToken } from "./Baton.js";

export type {
  Chain,
  Concurrency,
  // What `Chain.refusesEntry` is handed; a chain declaring the predicate as a
  // named function needs the name.
  EntryRefusalContext,
  // `TickResult.entries` carries one per fanout entry; a chain reading the
  // wave's per-entry outcomes into a helper needs the name.
  FanoutEntryOutcome,
  Phase,
  QuarantinedTag,
  TickContext,
  ShipContext,
  TickResult,
  WorktreeSetupContext,
  WorktreeSetupResult,
} from "./Phase.js";

export type { Gate, GateContext, GatePhase, GateResult } from "./Gate.js";

export {
  shellGate,
  tscGate,
  vitestGate,
  eslintGate,
  chainLoadGate,
  writablePathsGate,
  pendingGate,
  type PendingGateOptions,
  type ShellGateOptions,
  type PkgManagerOverride,
  type PkgManagerGate,
} from "./builtinGates.js";

export { setupWorktree } from "./setupWorktree.js";

// The value rides `FlumeApi.git.readWorktreeRegistry`; only the result
// type is named here, for a chain that holds one in a variable.
export { type WorktreeRegistry } from "./worktrees.js";

// Likewise for `FlumeApi.git.statusRecords`: the decoded record shape, for a
// chain that filters the list into a named variable.
export { type GitStatusRecord } from "./git.js";

export { type StandardSchemaV1 } from "./standardSchema.js";

export {
  composePendingEntry,
  parsePendingQueue,
  parsePendingQueueLoose,
  renderSchemaForPrompt,
  touchedPaths,
  isPickableNow,
  type PendingEntry,
  type PendingList,
  // The shape `parsePendingQueue` takes: one entry file's name and bytes.
  // A chain's own gate reading the queue at a commit holds a list of these.
  type QueueFile,
  type EntryExtension,
  type EntryExtensionField,
  type ParseError,
  type ParseResult,
  // `TickContext.queueParseFailure` / `TickResult.queueParseFailure` carry
  // one; a chain rendering the queue's parse errors into its repair prompt
  // needs the name.
  type QueueParseFailure,
} from "./PendingSchema.js";

export { partitionByFileOverlap, type PartitionOptions } from "./partition.js";

export { gitPath, matchesAny, slugify, stopFlagPath } from "./paths.js";

// The keyers ride the surface beside the paths: the map a chain reads
// (`TickContext.priorAttempts`) is keyed by a join the engine composes, so a
// consumer holding a queue entry, a singleton phase, or a record it pulled
// back out of that map takes the engine's own spelling instead of
// re-composing one. Both keyspaces are answered from whichever value a
// consumer happens to hold, so nothing is left for the join to cover.
export {
  entryAttemptKey,
  phaseAttemptKey,
  priorAttemptPath,
  priorAttemptsDir,
  recordAttemptKey,
  type PriorAttemptRef,
} from "./priorAttempts.js";

export {
  renderPrompt,
  NO_COMMIT_MODES,
  PRIOR_ATTEMPT_MODES,
  // The value rides `FlumeApi.InlineExecRenderError`; only the shape of its
  // `.failures` is named here, for a chain that reads one span's cmd/stderr.
  type InlineExecFailure,
  type NoCommitMode,
  type PriorAttempt,
  type PriorAttemptKeyspace,
  type PriorAttemptMode,
  type RenderOptions,
} from "./Prompt.js";

// `FlumePaths` is `Chain.worktreesBase`'s parameter: a chain declaring that
// callback anywhere but inline needs the name. `FlumeApiPaths` is what
// `FlumeApi.paths` actually holds — the same roots plus the resolved
// `stateRootRel`.
export {
  type FlumeApi,
  type FlumeApiPaths,
  type FlumePaths,
} from "./flumeApi.js";

export {
  Dispatcher,
  type DispatcherOptions,
  type RenderRequest,
  type RenderResolution,
  type TerminalMisconfiguration,
  type TickOutcome,
  type TickRequest,
} from "./Dispatcher.js";

// `TickOutcome.ledgerRefusal`'s own type: a chain reading a failed tick needs
// the name to hold what it read. The error that states it (`WaveLedgerRefusal`)
// stays internal — it never crosses this boundary.
export { type LedgerRefusalClass } from "./waveMerge.js";

export { type ChainModule, type ChainFactory } from "./chainLoad.js";

export { consoleLogger, type Logger } from "./log.js";

export {
  readTickVerdicts,
  readLatestVerdictsSync,
  // The two stage-failure records `TickVerdict`/`TickOutcome` list beside
  // `ProvisionFailure`: a chain routing a quarantine decision off one needs
  // to name what it is holding.
  type GateFailure,
  type MergeFailure,
  type ProvisionFailure,
  type TickVerdict,
  type ReportedGateResult,
  type TickVerdictInvocation,
  type TickVerdictMergeOutcome,
  type MergeOutcome,
} from "./tickVerdict.js";
