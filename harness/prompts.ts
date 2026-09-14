/**
 * The prompts the package ships (`spec/harness.md`, *The prompts and their
 * discipline*) — where each one lives, and the arguments every one of them
 * is rendered with.
 *
 * **Addressed from this module, never from a cwd.** A prompt is package
 * content, not consumer content: the phase a consumer runs is constructed
 * here, so the file it names is resolved from this module's own location
 * (`spec/harness.md`, *Where it lives*). The engine resolves a relative
 * `promptPath` against the chain's config directory and takes an absolute
 * one as given, so the absolute form is the only one that reaches the same
 * bytes from a consumer's state root as it does from this repo's.
 *
 * **Shared args are the facts the prompts must not restate.** The no-commit
 * vocabulary, the record cap, the entry hints, the schema block, the
 * artifact paths: each already has one home, and a prompt that spelled one
 * out would be a second copy that no gate reads and that a rename strands
 * mid-sentence (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*). Every value below is read from the
 * surface that owns it — the engine's `NO_COMMIT_MODES`, `records.ts`'s cap,
 * the entry extension's own hints, the consumer's declaration.
 *
 * A placeholder with no argument is refused by the engine's renderer before
 * the agent is invoked, so an arg this module stops supplying is a loud
 * render refusal rather than a `{{TOKEN}}` an agent reads as prose.
 *
 * Per-tick arguments — the assigned entry, the cited section, the windows a
 * slice opens over — are not here: they need a `TickContext` and belong to
 * the phase that has one. This module is the addresses and the per-tick-
 * invariant facts alone.
 */

import { fileURLToPath } from "node:url";

import {
  renderSchemaForPrompt,
  type EntryExtension,
} from "../src/PendingSchema.js";
import { resolvePendingPath } from "../src/paths.js";
import { NO_COMMIT_MODES } from "../src/Prompt.js";

import { PHASES, type Declaration } from "./declaration.js";
import { planStatePath } from "./planState.js";
import { RECORD_MAX_BYTES, recordDirs } from "./records.js";

/**
 * The discipline page the plan slices point at. Not a phase's prompt: no
 * tick renders it, and each slice's prompt names its path so the agent opens
 * it once rather than carrying it in every rendered tick. That is also why
 * it is the one shipped prompt with no placeholders in it — nothing
 * substitutes into a file the renderer never reads.
 */
const DISCIPLINE = "plan-discipline";

/**
 * Every prompt file the package ships: one per phase it constructs, plus the
 * discipline page. Derived from the phase list rather than spelled beside
 * it, so a phase added without its prompt is a missing file rather than a
 * silently unaddressed prompt.
 */
export const PROMPT_NAMES = [...PHASES, DISCIPLINE] as const;

/** One prompt the package ships. */
export type PromptName = (typeof PROMPT_NAMES)[number];

/**
 * The open-questions artifact under a state root, slash-joined like every
 * other path the package composes.
 *
 * Spelled here because nothing else owns it: the queue's path is the
 * engine's (`resolvePendingPath`), the plan state's is `planState.ts`'s, the
 * record queues' are `records.ts`'s, and this artifact's only readers are
 * the slice prompts rendered below. A second spelling anywhere is a slice
 * writing a question where the next slice does not look.
 */
const QUESTIONS_REL = "plan/open-questions.md";

/**
 * Where a prompt lives on disk — absolute, resolved from this module rather
 * than from any caller's cwd.
 *
 * The same relative hop holds in both layouts the package ships in: the
 * checkout's `harness/prompts.ts` beside `harness/prompts/`, and the emit's
 * `dist/harness/prompts.js` beside the `dist/harness/prompts/` the build
 * copies there.
 */
export function promptPath(name: PromptName): string {
  return fileURLToPath(new URL(`prompts/${name}.md`, import.meta.url));
}

/** What a prompt's shared arguments are composed from. */
export interface SharedPromptArgsInput {
  /** The consumer's validated declaration — its spec locus and its slots. */
  readonly declaration: Declaration;
  /**
   * The composed entry extension, package fields plus any the consumer
   * added (`entryExtension.ts`) — the one source of the schema block and the
   * two judge hints the build prompt quotes.
   */
  readonly extension: EntryExtension;
  /** The tick's resolved state root, as the engine reports it. */
  readonly stateRoot: string;
}

/**
 * The arguments every prompt the package renders is given, whatever phase is
 * running.
 *
 * Composed per tick because two of them are state-root-relative, and free of
 * `TickContext` because none of them varies within a tick: a phase's own
 * `promptArgs` adds what does.
 */
export function sharedPromptArgs(
  input: SharedPromptArgsInput,
): Record<string, string> {
  const { declaration, extension, stateRoot } = input;
  return {
    /**
     * The engine's no-commit taxonomy, rendered from the engine's own
     * declaration (`src/Prompt.ts`) — the whole point of this arg. A mode
     * renamed or added there reaches every prompt without one being edited,
     * and a prompt that listed them itself would keep reading as current
     * long after it stopped being true.
     */
    NO_COMMIT_MODES: backticked(NO_COMMIT_MODES),
    RECORD_MAX_BYTES: String(RECORD_MAX_BYTES),
    /** Where the slices send a reader for the discipline they share. */
    DISCIPLINE: promptPath(DISCIPLINE),
    PENDING_SCHEMA: renderSchemaForPrompt(extension),
    TESTS_HINT: hintOf(extension, "tests"),
    PINS_HINT: hintOf(extension, "pins"),
    SPEC_LOCUS: backticked(declaration.specLocus),
    PENDING_PATH: resolvePendingPath(stateRoot),
    QUESTIONS_PATH: `${stateRoot}/${QUESTIONS_REL}`,
    PLAN_STATE_PATH: planStatePath(stateRoot),
    RECORD_DIRS: backticked(recordDirs(stateRoot)),
    DOMAIN: slot("environment", declaration.slots?.domain),
    AUTONOMY: slot("autonomy", declaration.slots?.autonomy),
  };
}

/** A list as prompt prose: each item in backticks, comma-separated. */
function backticked(items: readonly string[]): string {
  return items.map((item) => `\`${item}\``).join(", ");
}

/**
 * A declared slot as the block the prompt carries, or nothing at all.
 *
 * The wrapper rides the value rather than the prompt file so an undeclared
 * slot renders to no bytes: an empty `<environment>` block is a section the
 * agent has to read and rule out, and a consumer that declared nothing
 * should cost nothing.
 */
function slot(name: string, text: string | undefined): string {
  return text === undefined ? "" : `<${name}>\n${text}\n</${name}>`;
}

/**
 * One field's hint from the composed extension, or a refusal naming it.
 *
 * The package's own `entryExtension()` always declares these, but the input
 * is whatever the chain factory composed; a hint quietly rendered as empty
 * would leave the build prompt announcing no contract at all for a list the
 * judge still enforces (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function hintOf(extension: EntryExtension, field: string): string {
  const declared = extension[field];
  if (declared === undefined) {
    throw new Error(
      `prompt args: the entry extension declares no "${field}" field, so ` +
        `the build prompt has no contract to quote for it (spec/harness.md, ` +
        `The entry extension)`,
    );
  }
  return declared.hint;
}
