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

export { partitionByFileOverlap } from "./partition.js";

export { gitPath, slugify, stopFlagPath } from "./paths.js";

export { priorAttemptPath, priorAttemptsDir } from "./priorAttempts.js";

export {
  renderPrompt,
  NO_COMMIT_MODES,
  type NoCommitMode,
  type PriorAttempt,
  type PriorAttemptKeyspace,
} from "./Prompt.js";

export { type FlumeApi } from "./flumeApi.js";

export {
  Dispatcher,
  consoleLogger,
  readTickVerdicts,
  readLatestVerdictsSync,
  type ChainModule,
  type ChainFactory,
  type DispatcherOptions,
  type Logger,
  type ProvisionFailure,
  type TerminalMisconfiguration,
  type TickOutcome,
  type TickVerdict,
  type TickVerdictGateResult,
  type TickVerdictInvocation,
  type TickVerdictMergeOutcome,
  type MergeOutcome,
} from "./Dispatcher.js";
