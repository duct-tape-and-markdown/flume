/**
 * Public surface for `flume`. Consumers import from here; package.json's
 * `exports` map restricts resolution to this entry point, so anything not
 * re-exported below is unreachable from outside the package.
 */

export type { Agent, AgentInvocation, AgentResult } from "./Agent.js";
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
  TickContext,
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

export { renderPrompt, type NoCommitMode } from "./Prompt.js";

export { type FlumeApi } from "./flumeApi.js";

export {
  Dispatcher,
  consoleLogger,
  readTickVerdicts,
  type ChainModule,
  type ChainFactory,
  type DispatcherOptions,
  type Logger,
  type ProvisionFailure,
  type TerminalMisconfiguration,
  type TickOutcome,
  type TickVerdict,
  type TickVerdictGateResult,
  type TickVerdictMergeOutcome,
  type MergeOutcome,
} from "./Dispatcher.js";
