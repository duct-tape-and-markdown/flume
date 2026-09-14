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
  TestFailure,
} from "./runner.js";

export {
  resolveVitest,
  vitestRunner,
  type VitestInvocation,
  type VitestRunnerOptions,
} from "./vitestRunner.js";

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
  DeclarationSchema,
  parseDeclaration,
  type Declaration,
  type HarnessPhase,
  type PlanSlice,
} from "./declaration.js";

export {
  defaultHandoff,
  resolveHandoff,
  type Handoff,
  type HandoffSlice,
  type ResolveHandoffOptions,
  type SliceWindow,
} from "./handoff.js";

export {
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
  PlanStateSchema,
  planStatePath,
  readPlanState,
  writePlanState,
  type PlanState,
} from "./planState.js";

export {
  harnessGates,
  type GateEngine,
  type HarnessGatesOptions,
} from "./gates.js";

export {
  PROMPT_NAMES,
  buildPromptArgs,
  promptPath,
  sharedPromptArgs,
  type BuildPromptArgsInput,
  type BuildTickContext,
  type PromptName,
  type SharedPromptArgsInput,
} from "./prompts.js";

export {
  RECORD_MAX_BYTES,
  notePath,
  notesDir,
  recordDirs,
  recordFiles,
  recordsPending,
} from "./records.js";

export {
  WINDOW_LINE_BUDGET,
  planSliceWindows,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type SliceInputs,
  type WindowContext,
} from "./windows.js";
