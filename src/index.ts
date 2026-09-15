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

export { Baton } from "./Baton.js";

export type {
  Chain,
  Concurrency,
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
  composePendingList,
  parsePending,
  parsePendingLoose,
  renderSchemaForPrompt,
  touchedPaths,
  isPickableNow,
  type PendingEntry,
  type PendingList,
  type EntryExtension,
  type EntryExtensionField,
  type ParseError,
  type ParseResult,
} from "./PendingSchema.js";

export { partitionByFileOverlap, type PartitionOptions } from "./partition.js";

export { gitPath, matchesAny, slugify, stopFlagPath } from "./paths.js";

export {
  priorAttemptPath,
  priorAttemptsDir,
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
  consoleLogger,
  readTickVerdicts,
  readLatestVerdictsSync,
  type ChainModule,
  type ChainFactory,
  type DispatcherOptions,
  // The two stage-failure records `TickVerdict`/`TickOutcome` list beside
  // `ProvisionFailure`: a chain routing a quarantine decision off one needs
  // to name what it is holding.
  type GateFailure,
  type Logger,
  type MergeFailure,
  type ProvisionFailure,
  type RenderRequest,
  type RenderResolution,
  type TerminalMisconfiguration,
  type TickOutcome,
  type TickVerdict,
  type ReportedGateResult,
  type TickVerdictInvocation,
  type TickVerdictMergeOutcome,
  type MergeOutcome,
} from "./Dispatcher.js";
