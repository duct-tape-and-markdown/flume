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
  DeclarationSchema,
  parseDeclaration,
  type Declaration,
} from "./declaration.js";

export {
  ENTRY_CAPS,
  EntryFieldRemovalError,
  entryExtension,
} from "./entryExtension.js";
