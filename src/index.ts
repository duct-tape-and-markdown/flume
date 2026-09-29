/**
 * Public surface for `flume`. package.json's `exports` map declares this
 * module at `.` and the harness package's own surface at `./harness`
 * (`harness/index.ts`), and resolution reaches nothing else: a name neither
 * entry point re-exports is unreachable from outside the package.
 */

export type { Agent, AgentInvocation, AgentResult, AgentUsage } from "./Agent.js";
// `BudgetDeclaration` is what `ClaudeCodeOptions.budget` takes, so a chain
// declaring its window and thresholds as a named constant needs the name
// from this entry point (`.claude/rules/engineering.md`, *An export earns its
// consumer*).
export type { BudgetDeclaration } from "./budgetHook.js";
export { claudeCode, type ClaudeCodeOptions } from "./claudeCode.js";
export { withSessionCapture, type SessionCaptureOpts } from "./sessionCapture.js";
export {
  withTerminalRenderer,
  type TerminalRendererOpts,
} from "./terminalRender.js";

// `BatonToken` is what `Baton.token` answers and `Baton.sleepIfUnchanged`
// takes, so a chain holding a phase's token across its own work needs to name
// it from this entry point (`.claude/rules/engineering.md`, *An export earns
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
// type is named here, for a chain that holds one in a variable — and its
// membership verdict beside it, for one that holds the answer about a single
// path rather than branching on it where it is asked.
export {
  type WorktreeMembership,
  type WorktreeRegistry,
} from "./worktrees.js";

// Likewise for `FlumeApi.git.statusRecords`: the decoded record shape, for a
// chain that filters the list into a named variable.
export { type GitStatusRecord } from "./git.js";

export { type StandardSchemaV1 } from "./standardSchema.js";

// And for `FlumeApi.readGatedQueue`: what it takes — the slice of a
// `GateContext` the read is keyed by, so a chain gate can hand one on — and
// the three facts it answers about the queue that commit holds.
export {
  type GatedQueue,
  type GatedQueueContext,
} from "./pendingLedger.js";

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

// `namespacedJoin` rides beside the others for the same reason they do: it is
// the fold the engine composes every fs path through, and the depth that makes
// it necessary is the consumer's — a worktree under a declared base, an
// entry-derived artifact under a relocated state root
// (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks fs
// calls with no long component*). Also on `FlumeApi`; named here so a chain
// helper composing a path outside a factory's scope can reach it.
export {
  gitPath,
  matchesAny,
  namespacedJoin,
  slugify,
  stopFlagPath,
} from "./paths.js";

// The proven-absence descent rides beside the path rules, and for the same
// reason: a chain gating on a directory of its own re-derives the
// ENOENT-vs-obstructed split otherwise, and the errno that split keys on is
// the one thing about it that is not portable (`.claude/rules/engineering.md`,
// *A fact the engine holds is reported, never rediscovered*). Both shapes,
// because composing the rooted one out of the other is that same
// rediscovery one rung lower: a chain holding a root and a directory beneath
// it hands over both and the engine walks between them
// (`isDirectoryOrAbsentUnder`), while a fan of siblings under a root already
// proven names its own list (`isDirectoryOrAbsent`). Also on `FlumeApi`;
// named here so a chain declaring a helper around either can type the value
// it holds.
export { isDirectoryOrAbsent, isDirectoryOrAbsentUnder } from "./fsProbe.js";

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

// The render seam crosses this boundary as types alone. Both halves — the
// loader that turns a phase's `promptPath` into bytes and the renderer that
// takes those bytes — ride `FlumeApi` (`api.readPhaseTemplate`,
// `api.renderPrompt`), where a chain already holds the paths and the fence
// they read, and `flume render` is the standalone surface for a caller
// holding neither. What a root import needs of that seam is the names for
// what it passes in and catches coming out, which is what follows.
export {
  NO_COMMIT_MODES,
  PRIOR_ATTEMPT_MODES,
  // The value rides `FlumeApi.InlineExecRenderError`; only the shape of its
  // `.failures` is named here, for a chain that reads one span's cmd/stderr.
  type InlineExecFailure,
  // The value rides `FlumeApi.RenderRefusal`; the type is named here because
  // it is the base every render-stage refusal extends, so it stands in
  // `InlineExecRenderError`'s own declaration and a heritage clause a
  // consumer can reach must resolve to an exported name.
  type RenderRefusal,
  // Likewise for `FlumeApi.PromptTemplateUnreadableError`: the one refusal
  // `api.readPhaseTemplate` raises, named here because that loader's hover
  // text links it and a chain holding the caught wall in a variable — to
  // report its `promptPath` and `resolvedPath` — needs the name from this
  // entry point.
  type PromptTemplateUnreadableError,
  type NoCommitMode,
  type PriorAttempt,
  // The base all six `PriorAttempt` variants extend: it stands in the hover
  // text of each, and importing a variant carries no name for it.
  type PriorAttemptEnvelope,
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

export {
  type ChainModule,
  type LoadedChain,
  type ChainFactory,
} from "./chainLoad.js";

export { consoleLogger, type Logger } from "./log.js";

export {
  readTickVerdicts,
  readLatestVerdictsSync,
  // The five stage-failure records `TickVerdict`/`TickOutcome` list beside
  // `ProvisionFailure`: a chain routing a quarantine decision off one needs
  // to name what it is holding. `PlatformFailure` is the one among them that
  // no entry can be blamed for, and says so in its own shape.
  type GateFailure,
  type MergeFailure,
  type PlatformFailure,
  type ProvisionFailure,
  type RenderFailure,
  type ShipFailure,
  // The record beside them that is not a failure: an entry a sibling tick
  // took between this wave's selection and its stake, with the holder it
  // names (`PidClaim`, re-exported below for the same reason).
  type StakeLoss,
  type TickVerdict,
  type ReportedGateResult,
  type TickVerdictInvocation,
  type TickVerdictMergeOutcome,
  type MergeOutcome,
  // `TickVerdict.timings`' own row type: a chain reading what a tick spent on
  // gates and merges needs the name to hold what it read.
  type TickVerdictTiming,
} from "./tickVerdict.js";

// `StakeLoss.by`'s own type: the statement a guard file's holder wrote, as
// the engine decoded it. A chain reading which sibling took an entry names
// what it is holding, exactly as it does for the stage-failure records above.
export { type PidClaim } from "./pidClaim.js";
