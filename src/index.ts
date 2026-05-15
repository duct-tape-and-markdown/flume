/**
 * Public surface for `flume`. Consumers import from here; everything else is
 * internal-ish (but not enforced — there's no exports map yet).
 */

export type { Agent, AgentInvocation, AgentResult } from "./Agent.ts";
export {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
  type ClaudeCodeOptions,
  type SessionCaptureOpts,
  type TerminalRendererOpts,
} from "./Agent.ts";

export { Baton } from "./Baton.ts";

export type {
  Chain,
  Concurrency,
  Phase,
  TickContext,
  TickResult,
} from "./Phase.ts";

export type { Gate, GateContext, GatePhase, GateResult } from "./Gate.ts";

export {
  shellGate,
  tscGate,
  vitestGate,
  eslintGate,
  writablePathsGate,
} from "./builtinGates.ts";

export {
  PendingEntry,
  PendingList,
  parsePending,
  renderSchemaForPrompt,
  touchedPaths,
  isPickableNow,
  type ParseError,
  type ParseResult,
} from "./PendingSchema.ts";

export { partitionByFileOverlap } from "./partition.ts";

export { renderPrompt } from "./Prompt.ts";

export {
  Dispatcher,
  consoleLogger,
  type DispatcherOptions,
  type Logger,
  type TickOutcome,
} from "./Dispatcher.ts";
