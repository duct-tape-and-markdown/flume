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
 * the entry extension's own hints, the consumer's declaration. The turn
 * boundary is the one this module owns outright: nothing else holds it, so
 * the single home *is* the constant below.
 *
 * A placeholder with no argument is refused by the engine's renderer before
 * the agent is invoked, so an arg this module stops supplying is a loud
 * render refusal rather than a `{{TOKEN}}` an agent reads as prose.
 *
 * **Build's per-tick arguments are here too, and a slice's are not.** Build's
 * five — the entry, its cite's path, section and section text, and the note
 * it may write — are the shipped build prompt's own placeholders, composed
 * from the tick's `TickContext` and read from the surfaces that own them: the
 * cite through the resolver the `per` gate drives, the note path through
 * `records.ts`. A slice's window is a scan with a liveness predicate on the
 * other end of it, which is `sliceWindow.ts`'s subject and its windows', not
 * this module's.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderSchemaForPrompt,
  type EntryExtension,
  type PendingEntry,
} from "../src/PendingSchema.js";
import { resolvePendingPath } from "../src/paths.js";
import { NO_COMMIT_MODES } from "../src/Prompt.js";

import { resolveCiteSync } from "./citeResolver.js";
import { PHASES, type Declaration } from "./declaration.js";
import { PerSchema } from "./entryExtension.js";
import { planStatePath } from "./planState.js";
import { RECORD_MAX_BYTES, notePath, recordDirs } from "./records.js";

/**
 * The discipline page the plan slices point at. Not a phase's prompt: no
 * tick renders it, and each slice's prompt names its path so the agent opens
 * it once rather than carrying it in every rendered tick. That is also why
 * it is the one shipped prompt with no placeholders in it — nothing
 * substitutes into a file the renderer never reads.
 */
const DISCIPLINE = "plan-discipline";

/**
 * What a tick is, from inside the agent invocation that runs it: one turn.
 *
 * The one shared value the package *authors* rather than reads off another
 * surface — no engine export holds it, because the fact is about the harness
 * that invokes the agent rather than about anything the engine computes.
 * Spelled once here for the reason every other arg in this module is: four
 * prompts carrying four copies is four things to edit and three to go stale
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * Field-traced: an agent that armed a watcher on its own suite and ended its
 * turn ended the invocation with it, and the work the watcher was going to
 * commit died with the worktree. No prompt the package shipped said the turn
 * was the boundary, so nothing was contradicted.
 */
const TURN_BOUNDARY = `**One tick is one turn.** Ending your turn ends this invocation, and nothing wakes it afterwards. A command left running in the background, a scheduled wake-up, a watcher armed on your own work, a message whose reply you meant to read: each is a continuation this process will not be alive for, and whatever it would have written dies uncommitted with the worktree. Wait inside the turn on anything you started, and name what you left undone in the commit this tick writes.`;

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
 * engine's (`resolvePendingPath`), the plan state's is `planState.ts`'s and
 * the record queues' are `records.ts`'s. Two readers share this one —
 * the slice prompts rendered below, and the fence the chain factory hands
 * every plan slice. A second spelling anywhere is a slice writing a question
 * where the next slice does not look, or a fence that reverts the commit
 * carrying it.
 */
export function questionsPath(stateRoot: string): string {
  return `${stateRoot}/plan/open-questions.md`;
}

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

/**
 * Every key {@link sharedPromptArgs} returns, in the order it builds them.
 *
 * **Declared here so a phase can hand them to the engine as data.** Nothing
 * this module composes is prompt syntax the package authored: a rendered
 * schema, a hint a consumer wrote, a declared slot's prose, a path. The
 * engine's renderer scans substituted text for inline-exec spans
 * (`spec/prompt.md`, *The render pipeline*), so a value that merely quotes
 * the span grammar would run as a command; a phase naming these in
 * `Phase.promptDataKeys` makes the engine neutralize them before that scan.
 *
 * The list is the producer's return type, not a second copy of it — a key
 * added below without being named here fails the typecheck at the literal,
 * and a declared key a tick never returns is simply unused.
 */
export const SHARED_PROMPT_DATA_KEYS = [
  "TURN_BOUNDARY",
  "NO_COMMIT_MODES",
  "RECORD_MAX_BYTES",
  "DISCIPLINE",
  "PENDING_SCHEMA",
  "TESTS_HINT",
  "PINS_HINT",
  "SPEC_LOCUS",
  "PENDING_PATH",
  "QUESTIONS_PATH",
  "PLAN_STATE_PATH",
  "RECORD_DIRS",
  "DOMAIN",
  "AUTONOMY",
] as const;

/** One argument every prompt the package renders is given. */
export type SharedPromptArg = (typeof SHARED_PROMPT_DATA_KEYS)[number];

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
): Record<SharedPromptArg, string> {
  const { declaration, extension, stateRoot } = input;
  return {
    /** The invocation boundary every phase runs inside. */
    TURN_BOUNDARY,
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
    QUESTIONS_PATH: questionsPath(stateRoot),
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

// ------------------------------------------------- build's per-tick args

/**
 * The `TickContext` fields build's per-tick arguments read.
 *
 * Shaped so a `TickContext` satisfies it as given — the phase hands `ctx`
 * straight through rather than unpacking it into a second vocabulary
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 */
export interface BuildTickContext {
  /** The tick's provisioned worktree — `TickContext.cwd`. */
  readonly cwd: string;
  /** The tick's resolved state root — `TickContext.flumeDir`. */
  readonly flumeDir: string;
  /**
   * That state root as the repository addresses it, `undefined` when it is
   * relocated outside the repo — `TickContext.stateRootRel`, which the
   * dispatcher computes once and hands every hook (`spec/chain.md`, *What a
   * hook receives*). Read rather than derived: the tick's `cwd` is its own
   * worktree and `flumeDir` is not under it, so the offset between the two
   * roots is knowable here only because the engine reports it.
   */
  readonly stateRootRel?: string | undefined;
  /** The entry this tick was handed — `TickContext.assignedEntry`. */
  readonly assignedEntry?: PendingEntry | undefined;
}

/**
 * Every key {@link buildPromptArgs} returns — the entry as the queue holds
 * it, its cite's path, section and section text, and the note path.
 *
 * Data, every one of them, and the two that most need saying so: an entry's
 * own prose and a cited spec section are content the package did not author,
 * and the section a build entry cites is routinely the one *documenting* the
 * span grammar. Typed against the producer below for the reason
 * {@link SHARED_PROMPT_DATA_KEYS} is.
 */
export const BUILD_PROMPT_DATA_KEYS = [
  "ENTRY_JSON",
  "PER_PATH",
  "PER_SECTION",
  "PER_SECTION_TEXT",
  "NOTE_PATH",
] as const;

/** One argument build's prompt is rendered with for a tick. */
export type BuildPromptArg = (typeof BUILD_PROMPT_DATA_KEYS)[number];

/** What build's per-tick arguments are composed from. */
export interface BuildPromptArgsInput {
  /** The consumer's validated declaration — the locus a `per` resolves in. */
  readonly declaration: Declaration;
  /** The tick itself — every per-tick fact these args need is on it. */
  readonly ctx: BuildTickContext;
}

/**
 * The arguments build's prompt is rendered with for one tick, beside the
 * shared ones: the entry as the queue holds it, the section its `per` cites
 * as this tick's tree holds it, and the one note the tick may write.
 *
 * **The cite is resolved, never re-read.** The section text comes back from
 * the same resolver the `per` gate drove over the queue that carried this
 * entry, so a cite plan was held to is a cite this render quotes verbatim
 * (`citeResolver.ts`). A cite that no longer resolves throws rather than
 * rendering a stand-in section: the entry was derived from prose that has
 * since moved, and handing build the nearest paragraph is a tick spent
 * against the wrong contract (`.claude/rules/engineering.md`, *Loud or
 * nothing*). The throw reaches the dispatcher before the agent is invoked,
 * which is where a mis-cited entry is cheapest to see.
 *
 * **The note path is repo-relative**, as the records gate keys it: the prompt
 * tells the agent which path to write, and the agent writes inside its own
 * worktree, where an absolute path resolved from the state root would target
 * the trunk checkout's copy instead.
 */
export function buildPromptArgs(
  input: BuildPromptArgsInput,
): Record<BuildPromptArg, string> {
  const { declaration, ctx } = input;
  const entry = ctx.assignedEntry;
  if (entry === undefined) {
    throw new Error(
      `prompt args: build is a fanout phase and its prompt states the ` +
        `entry it was handed, so a tick with no assigned entry has nothing ` +
        `to render (spec/harness.md, The phases)`,
    );
  }
  // Through the package's own `per` schema — the shape a plan tick was
  // validated against, never a second reading of the same two fields.
  const cite = PerSchema.parse(entry.per);
  const verdict = resolveCiteSync(cite, declaration, inTree(ctx.cwd));
  if (!verdict.ok) {
    throw new Error(
      `prompt args: ${entry.tag}'s per cite does not resolve in this tick's ` +
        `tree — ${verdict.message}`,
    );
  }
  return {
    ENTRY_JSON: JSON.stringify(entry, null, 2),
    PER_PATH: cite.path,
    PER_SECTION: cite.section,
    PER_SECTION_TEXT: verdict.text,
    NOTE_PATH: notePath(noteRoot(ctx), entry.tag),
  };
}

/**
 * The tick's own working tree as a cite reader: bytes under `cwd`, and
 * `null` for a path the tree does not hold — the two answers the engine's
 * at-ref reader gives a gate, so one resolver serves both.
 *
 * Every other read failure travels out: a cited path that is a directory, or
 * one this process may not read, is a fault at the reader rather than a cite
 * to be refused for a reason it did not commit (*Loud or nothing*).
 */
function inTree(cwd: string): (path: string) => string | null {
  return (path) => {
    try {
      return readFileSync(join(cwd, path), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
}

/**
 * The state root as the repository addresses it — a **git path**,
 * forward-slashed — or a refusal.
 *
 * A state root outside the repo tree has no path in any commit, so the note
 * the prompt would name is one the records gate cannot admit and the park
 * shape cannot be read back from — the channel build's prompt promises is not
 * there. The engine reports that case as an absent `stateRootRel`; refused
 * here rather than rendered as a path that silently writes nowhere the tick's
 * commit reaches (*Loud or nothing*).
 *
 * The offset the engine does report is already git's alphabet
 * (`computeStateRootRel`, `src/Dispatcher.ts`), which is what the note this
 * names has to be: the path the agent commits, the records gate keys, and the
 * park predicate reads back are all git paths, and a prompt naming the host's
 * spelling instead sends a tick to write where none of the three looks.
 */
function noteRoot(ctx: BuildTickContext): string {
  if (ctx.stateRootRel === undefined) {
    throw new Error(
      `prompt args: the state root ${ctx.flumeDir} resolves outside the ` +
        `repository, so build's note is no path in the tick's commit and ` +
        `the park it carries could not be read back (spec/harness.md, ` +
        `Committed-path discipline)`,
    );
  }
  return ctx.stateRootRel;
}
