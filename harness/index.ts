/**
 * Public surface for the harness package — flume's opinion about how to run
 * the engine, shipped beside it (`spec/harness.md`). A consumer imports from
 * here; `src/` never imports anything under this directory.
 */

export type {
  Lane,
  NamedResult,
  RunResult,
  Runner,
  RunnerContext,
  RunnerFactory,
  TestFailure,
} from "./runner.js";

export {
  resolveVitest,
  vitestRunner,
  type VitestInvocation,
  type VitestRunnerOptions,
} from "./vitestRunner.js";

export {
  scriptRunner,
  type ScriptReader,
  type ScriptReport,
  type ScriptRunnerOptions,
} from "./scriptRunner.js";

export {
  judgeNamedLines,
  type JudgeOutcome,
  type JudgeRequest,
  type JudgeVerdict,
  type LineLane,
  type LineState,
  type LineVerdict,
} from "./judge.js";

export { consumerIgnores } from "./ignores.js";


export {
  DEFAULT_STATE_ROOT,
  harnessInit,
  protocolTemplatePath,
  type DependencyOutcome,
  type HarnessInitOptions,
  type HarnessInitResult,
  type PlanStateOutcome,
} from "./init.js";

export {
  harnessChain,
  type HarnessChainOptions,
} from "./chain.js";

export { type CiTitleReader } from "./ci.js";

export {
  DeclarationSchema,
  parseDeclaration,
  type Declaration,
  type DeclarationInput,
  type HarnessPhase,
  type PlanSlice,
} from "./declaration.js";

export {
  defaultHandoff,
  defaultRefusesEntry,
  resolveHandoff,
  type Handoff,
  type HandoffSlice,
  type ResolveHandoffOptions,
  type SliceWindow,
} from "./handoff.js";

export {
  CONTRACT_TOUCHING_FIELD,
  ENTRY_CAPS,
  EntryFieldRemovalError,
  entryExtension,
} from "./entryExtension.js";

export {
  resolveCite,
  resolveCiteSync,
  type AtRefReader,
  type Cite,
  type CiteLocus,
  type CiteVerdict,
  type SectionResolver,
} from "./citeResolver.js";

export {
  continuingNotePath,
  continuingNotesDir,
  legacyPlanStatePath,
  noteGlobs,
  notePath,
  notePaths,
  notesDir,
  parkedNotePath,
  planStatePath,
  recordDirs,
} from "./layout.js";

export {
  PLAN_STATE_SCHEMAS,
  readPlanState,
  writePlanState,
  type PlanStateOf,
  type PlanStateWriteOf,
} from "./planState.js";

export {
  harnessGates,
  type GateEngine,
  type HarnessGatesOptions,
} from "./gates.js";

export {
  putDownPredicate,
  type PutDownKind,
  type PutDownPredicate,
  type PutDownSpan,
} from "./putDown.js";

export {
  BUILD_PROMPT_DATA_KEYS,
  PLAN_SLICE_PROMPT_DATA_KEYS,
  PROMPT_NAMES,
  SHARED_PROMPT_DATA_KEYS,
  buildPromptArgs,
  planSlicePromptArgs,
  promptPath,
  sharedPromptArgs,
  type BuildPromptArg,
  type BuildPromptArgsInput,
  type BuildTickContext,
  type PlanSlicePromptArg,
  type PromptName,
  type SharedPromptArg,
  type SharedPromptArgsInput,
} from "./prompts.js";

export {
  RECORD_MAX_BYTES,
  recordFiles,
  recordsPending,
} from "./records.js";

export {
  WINDOW_LINE_BUDGET,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type WindowContext,
} from "./sliceWindow.js";

export { planSliceWindows } from "./windows.js";
