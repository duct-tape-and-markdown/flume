/**
 * Public surface for `flume`. Consumers import from here; everything else is
 * internal-ish (but not enforced — there's no exports map yet).
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
} from "./builtinGates.js";

export { setupWorktree } from "./setupWorktree.js";

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

export { renderPrompt } from "./Prompt.js";

export {
  Dispatcher,
  consoleLogger,
  readTickVerdicts,
  type ChainModule,
  type DispatcherOptions,
  type Logger,
  type TickOutcome,
  type TickVerdict,
  type TickVerdictGateResult,
  type TickVerdictMergeOutcome,
  type MergeOutcome,
} from "./Dispatcher.js";
