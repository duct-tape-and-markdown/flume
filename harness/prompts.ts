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
 * the entry extension's own hints, the consumer's declaration. Two are this
 * module's outright — the turn boundary, and when a tick puts its work down
 * beside what each phase puts down — because nothing else holds a reading of
 * the invocation or of the engine's budget line, so the single home *is* the
 * constant and the function below.
 *
 * A placeholder with no argument is refused by the engine's renderer before
 * the agent is invoked, so an arg this module stops supplying is a loud
 * render refusal rather than a `{{TOKEN}}` an agent reads as prose.
 *
 * **Build's per-tick arguments are here too, and a slice's path is.** Build's
 * own — the entry, its cite's path, section and section text, the notes it
 * may write and the continuation standing at one of them — are the shipped
 * build prompt's own placeholders, composed from the tick's `TickContext` and
 * read from the surfaces that own them: the cite through the resolver the
 * `per` gate drives, the note path through `layout.ts`, the continuation
 * through the tick's own tree at that path. A plan slice's own state file is here for the same reason —
 * a path off the layout ({@link planSlicePromptArgs}). What is not here is a
 * slice's *window*: that is a scan with a liveness predicate on the other end
 * of it, which is `sliceWindow.ts`'s subject and its windows'.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderSchemaForPrompt,
  type EntryExtension,
  type PendingEntry,
} from "../src/PendingSchema.js";
import { isDirectoryOrAbsentUnder } from "../src/fsProbe.js";
import { namespacedJoin, resolvePendingDir } from "../src/paths.js";
import { NO_COMMIT_MODES } from "../src/Prompt.js";

import { resolveCiteSync } from "./citeResolver.js";
import {
  PHASES,
  type Declaration,
  type HarnessPhase,
  type PlanSlice,
} from "./declaration.js";
import { PerSchema } from "./entryExtension.js";
import {
  continuingNotePath,
  notePath,
  parkedNotePath,
  planStatePath,
  questionsDir,
  recordDirs,
} from "./layout.js";
import { PLAN_STATE_SHAPES } from "./planState.js";
import { renderQuestions } from "./questions.js";
import { RECORD_MAX_BYTES } from "./records.js";

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
 * What each phase puts down when the room runs out — one act per phase,
 * beside the statement that frames them so the thresholds are stated once
 * and only the act varies.
 *
 * Each names the phase's own coherent unit and the cursor or record that
 * carries what is left, because "stop" without it is an instruction to
 * abandon a tick rather than to close one.
 */
const PUT_DOWN_ACTS: Record<HarnessPhase, string> = {
  "plan-inbox":
    "commit the records you have routed, and leave the rest on disk for the next inbox tick to see again",
  "plan-derive":
    "commit the entries you have derived, and advance `derivedThrough` only through the commits you finished — never past them as bookkeeping",
  "plan-sweep":
    "commit the neighborhoods you have swept with every frontier module you read recorded covered, and leave the rotation open",
  build:
    "commit the coherent, green segment you have and declare the rest another tick's work in a continuing note",
};

/**
 * When a tick puts its work down, and what putting it down *is* for the
 * phase reading the line (`spec/harness.md`, *A tick puts work down*).
 *
 * Beside {@link TURN_BOUNDARY}, and the package's to author for the same
 * reason: the thresholds are a reading of the budget line, and no engine
 * export holds a reading.
 *
 * **A threshold per fact the line can carry.** The line is the engine's
 * (`src/budgetLine.ts`): elapsed wall clock and tool calls on every line, the
 * context percentage only where the chain declared `contextWindow`. A
 * statement naming the percentage alone would be a dial an undeclared-window
 * chain never sees, so each fact gets its own threshold and the agent reads
 * the ones its own line printed.
 *
 * **The absence clause is the line the engine actually sends.** No window
 * declared composes a line *without a percentage*, not a missing line; a
 * line that fails to arrive is a transcript the hook could not read, and
 * says nothing about the room. Reading absence as "no window declared" would
 * hand the agent a verdict on a fact it never received
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 */
function putDownStatement(phase: HarnessPhase): string {
  return `**If the room is running out, put the work down rather than be cut off by it.** A budget line arrives after a tool call with the facts of this session: elapsed wall clock, tool calls so far, and — where this chain declared the model's context window — the context used against it. Each fact carries its own threshold, and you read the ones your line actually printed. **On the window:** at **70%** open no new ground and land the segment you are already in; at **80%** stop. **On the clock:** past **45 minutes** land what is green; past **60 minutes** stop. **A line with no percentage in it is a chain that declared no window** — nothing is missing from that line, and the clock is the whole dial. A line that does not arrive at all is a session transcript the hook could not read: it says nothing about the room you have, and the call is yours on your own reading. Putting the work down is for work that will not fit in one tick — never a licence to stop while the room is there, and never a way to land work that is not green. Here it means: ${PUT_DOWN_ACTS[phase]}.`;
}

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
  "PUT_DOWN",
  "NO_COMMIT_MODES",
  "RECORD_MAX_BYTES",
  "DISCIPLINE",
  "PENDING_SCHEMA",
  "TESTS_HINT",
  "PINS_HINT",
  "SPEC_LOCUS",
  "PENDING_DIR",
  "QUESTIONS_DIR",
  "QUESTIONS_INDEX",
  "RECORD_DIRS",
  "DOMAIN",
  "AUTONOMY",
] as const;

/** One argument every prompt the package renders is given. */
export type SharedPromptArg = (typeof SHARED_PROMPT_DATA_KEYS)[number];

/** What a prompt's shared arguments are composed from. */
export interface SharedPromptArgsInput {
  /**
   * The phase being rendered. Every value below is the same for all four but
   * one: what a tick puts down when its budget line says to is the phase's
   * own act, and it is composed here rather than per phase so the thresholds
   * around it have one home ({@link putDownStatement}).
   */
  readonly phase: HarnessPhase;
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
 * Composed per tick because three of them are state-root-relative and one of
 * those reads the disk under it, and free of `TickContext` because none of
 * them varies within a tick: a phase's own `promptArgs` adds what does.
 */
export function sharedPromptArgs(
  input: SharedPromptArgsInput,
): Record<SharedPromptArg, string> {
  const { declaration, extension, phase, stateRoot } = input;
  return {
    /** The invocation boundary every phase runs inside. */
    TURN_BOUNDARY,
    /** When to put the work down, and what this phase puts down. */
    PUT_DOWN: putDownStatement(phase),
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
    PENDING_DIR: resolvePendingDir(stateRoot),
    QUESTIONS_DIR: questionsDir(stateRoot),
    /**
     * Which questions are open, read off the directory that holds them
     * (`questions.ts`) rather than grepped out of a page by a span in each
     * slice's prompt. Presence is the state, so the listing *is* the index,
     * and the three prompts carrying the block share one render of it.
     */
    QUESTIONS_INDEX: renderQuestions(stateRoot),
    RECORD_DIRS: backticked(recordDirs(stateRoot)),
    DOMAIN: slot("environment", declaration.slots?.domain),
    AUTONOMY: slot("autonomy", declaration.slots?.autonomy),
  };
}

/**
 * Every key {@link planSlicePromptArgs} returns — a plan slice's own, on top
 * of the shared ones.
 *
 * Declared here for the reason {@link SHARED_PROMPT_DATA_KEYS} is: a phase
 * hands these to the engine as data so the renderer neutralizes them before
 * its inline-exec scan reads them as commands (`spec/prompt.md`, *The render
 * pipeline*).
 */
export const PLAN_SLICE_PROMPT_DATA_KEYS = [
  "PLAN_STATE_PATH",
  "PLAN_STATE_SHAPE",
  "CLAIMED_ENTRIES",
  "CLAIMED_TAGS",
] as const;

/** One argument every plan slice's prompt is given, beyond the shared set. */
export type PlanSlicePromptArg = (typeof PLAN_SLICE_PROMPT_DATA_KEYS)[number];

/**
 * The arguments one plan slice's prompt is given beyond the shared set: the
 * path of the state file that slice owns, and the entries a build tick holds
 * a claim on as this tick read them.
 *
 * **Not a shared arg, because the value is not shared.** Plan state is one
 * file per writer (`spec/harness.md`, *Plan state as declared state*), so
 * "the plan state path" is a different file per slice, and a single shared
 * value would be one slice's file handed to all three — the prompt that
 * `cat`s it would read a sibling's cursor and the fence would revert the tick
 * that wrote back what it read. Composed here rather than in each window,
 * because it is a path off the layout and not a scan of a tree
 * (`sliceWindow.ts`). The claimed set is here for the mirror of that reason:
 * it is a fact the engine already reported on the tick, not a scan either
 * ({@link claimedBlock}).
 *
 * It is rendered twice from that one value — the block a slice reads once,
 * and the bare tags the queue listing's own span marks its lines by
 * ({@link claimedTagWords}) — because a prose block above a listing is not
 * where a drain decides on an entry: the line is. Two renderings of one
 * argument, not two sources (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*).
 *
 * `claimed` defaults to the empty set for the reason `TickContext.claimed`
 * is optional — a hand-built context carries no engine read — and a
 * dispatcher-built one always names it.
 */
export function planSlicePromptArgs(
  slice: PlanSlice,
  stateRoot: string,
  claimed: readonly string[] = [],
): Record<PlanSlicePromptArg, string> {
  return {
    PLAN_STATE_PATH: planStatePath(stateRoot, slice),
    PLAN_STATE_SHAPE: planStateShape(slice),
    CLAIMED_ENTRIES: claimedBlock(claimed),
    CLAIMED_TAGS: claimedTagWords(claimed),
  };
}

/**
 * The literal JSON `slice`'s state file takes, one arm per line — read off
 * {@link PLAN_STATE_SHAPES}, which the typecheck holds to the schema the
 * slice-state gate enforces.
 *
 * Rendered on every tick, not only a slice's first: the tick with no file of
 * its own is the one that most needs the shape, and it is the one whose
 * `<plan-state>` block has nothing to show.
 */
function planStateShape(slice: PlanSlice): string {
  return (PLAN_STATE_SHAPES[slice] as readonly unknown[])
    .map((arm) => JSON.stringify(arm))
    .join("\n");
}

/**
 * The entries a build tick is carrying, as the block a plan slice's prompt
 * renders — or no bytes at all when nothing is in flight.
 *
 * **The set is the engine's, and so is the list.** A tick reads the claims
 * directory once and reports the tags on its context (`TickContext.claimed`,
 * `src/Phase.ts`); a slice that scanned for them itself would be a second
 * reader of a fact the engine already handed it
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * **What the block says about them is the package's.** The engine states
 * which entries are someone's; leaving them as they stand, and filing what
 * a slice would have changed as its own entry, is flume's opinion about
 * producers, which is what the harness package is for
 * (`.claude/rules/engine-boundary.md`, *Capability vs convention*).
 *
 * Nothing renders on an empty set, for the reason {@link slot} renders
 * nothing for an undeclared slot: an empty block is a section the agent has
 * to read and rule out, and a quiet queue should cost it nothing.
 */
function claimedBlock(claimed: readonly string[]): string {
  if (claimed.length === 0) return "";
  return [
    "<in-flight>",
    `A build tick is carrying ${backticked(claimed)} right now.`,
    "Each is its holder's until the attempt ends: leave the entry as the",
    "queue states it — no re-scope, no retire, no gate change — and file what",
    "you would have changed as an entry of its own, or say so in the commit",
    "body.",
    "</in-flight>",
  ].join("\n");
}

/**
 * The same set as shell words: each tag as itself, space-separated, for the
 * membership test the queue listing's span runs over the file names it is
 * already printing.
 *
 * Substituted into a double-quoted shell string, and safe there by the tag
 * grammar rather than by escaping: `TAG_PATTERN` (`src/PendingSchema.ts`)
 * admits `[A-Za-z0-9._()-]` alone, so no tag carries a space, a quote, a
 * backslash, or an expansion character. A grammar that widened to any of
 * those moves this renderer with it.
 *
 * Empty for an empty set, so the span's test matches nothing and the listing
 * renders exactly as it did before claims existed.
 */
function claimedTagWords(claimed: readonly string[]): string {
  return claimed.join(" ");
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
 * it, its cite's path, section and section text, the note paths, one per
 * kind (`layout.ts`), and the continuing note standing at one of them.
 *
 * Data, every one of them, and the three that most need saying so: an entry's
 * own prose, a prior tick's note and a cited spec section are content the
 * package did not author,
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
  "PARK_NOTE_PATH",
  "CONTINUING_NOTE_PATH",
  "CONTINUING_NOTE",
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
 * as this tick's tree holds it, the one note the tick may write, and the
 * continuation a prior tick on the entry left standing.
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
 * **The note paths are repo-relative**, as the records gate keys them: the
 * prompt tells the agent which path to write, and the agent writes inside its
 * own worktree, where an absolute path resolved from the state root would
 * target the trunk checkout's copy instead.
 *
 * **Every kind is named, because the kind is the path** (`spec/harness.md`,
 * *Records as one file each*). A tick says whether it shipped, parked, or put
 * the rest of the entry down by which of the three it wrote, and the
 * predicates read exactly that back (`chain.ts`) — so a prompt naming only
 * some of them would leave the rest for the agent to compose, at a spelling
 * nothing downstream looks for.
 *
 * **The standing continuation is read from the tick's own tree, at the path
 * these args already name.** The worktree is where the prior tick's commit
 * landed and where this tick will `git rm` the note, so it is the one copy
 * whose presence answers the question the block exists to ask; composing a
 * second path from the state root would read the trunk checkout's copy — a
 * different file, at a different commit.
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
  const read = inTree(ctx.cwd);
  const verdict = resolveCiteSync(cite, declaration, read);
  if (!verdict.ok) {
    throw new Error(
      `prompt args: ${entry.tag}'s per cite does not resolve in this tick's ` +
        `tree — ${verdict.message}`,
    );
  }
  const continuing = continuingNotePath(noteRoot(ctx), entry.tag);
  return {
    ENTRY_JSON: JSON.stringify(entry, null, 2),
    PER_PATH: cite.path,
    PER_SECTION: cite.section,
    PER_SECTION_TEXT: verdict.text,
    NOTE_PATH: notePath(noteRoot(ctx), entry.tag),
    PARK_NOTE_PATH: parkedNotePath(noteRoot(ctx), entry.tag),
    CONTINUING_NOTE_PATH: continuing,
    CONTINUING_NOTE: continuingBlock(continuing, read(continuing)),
  };
}

/**
 * The continuing note standing for this entry as the block build's prompt
 * carries it, or no bytes at all when none stands.
 *
 * **The segment before this one is only in the note.** A continuation leaves
 * the entry in the queue with its span already on the trunk
 * (`spec/harness.md`, *A tick puts work down*), so the next tick on it is
 * handed a prior-attempt record that says nothing about a commit that
 * *landed* — what that tick left, and where it said to look, is the note and
 * nothing else. Written and never read back, the declaration costs a tick and
 * buys the next one nothing.
 *
 * **Verbatim, and quoted as the prior tick's words rather than as this
 * prompt's instructions.** The note is agent-authored prose addressed to its
 * own successor; summarizing it here would be this module deciding what the
 * last tick meant, and folding it into the task body would give one tick's
 * account the standing of the package's own paragraphs.
 *
 * Nothing renders on an absent note, for the reason {@link slot} renders
 * nothing for an undeclared slot: an empty block is a section the agent has
 * to read and rule out, and a first tick on an entry should cost it nothing.
 */
function continuingBlock(path: string, text: string | null): string {
  if (text === null) return "";
  return [
    `<continuing-note path="${path}">`,
    `The last tick on this entry landed a green segment and put the rest`,
    `down. Its own account of what landed, what is next and where to look —`,
    `no prior-attempt record carries a commit that landed, so this is the`,
    `only one:`,
    "",
    text.trimEnd(),
    `</continuing-note>`,
  ].join("\n");
}

/**
 * The subject the descent below names when it refuses — one spelling for
 * both artifacts read through this reader, since what is obstructed is the
 * tick's tree and the refusal already carries the rung itself.
 */
const TREE_SUBJECT = "the tick's working tree";

/**
 * The tick's own working tree as a reader: bytes under `cwd`, and `null` for
 * a path the tree does not hold — the two answers the engine's at-ref reader
 * gives a gate, so one resolver serves both the cite and the standing
 * continuation.
 *
 * Every other read failure travels out: a cited path that is a directory, or
 * one this process may not read, is a fault at the reader rather than a cite
 * to be refused for a reason it did not commit (*Loud or nothing*).
 *
 * `null` is proven from the **path**, never read off the errno the read
 * raised. A plain file anywhere above the artifact makes the artifact
 * beneath it `ENOENT` on win32 while posix raises `ENOTDIR`
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so an errno-keyed silent arm reads an
 * obstructed tree as a tree holding nothing on exactly one host — which
 * renders a continuation the prior tick did leave as no block at all, and
 * hands the next tick an entry whose landed segment is described nowhere.
 * Hence the descent from `cwd` down to the directory the artifact sits in,
 * every rung asserted a directory before the next is probed
 * ({@link isDirectoryOrAbsentUnder}, `src/fsProbe.ts`, which composes those
 * rungs for every reader running this walk), so both hosts answer alike.
 * `cwd` is where the descent starts: the dispatcher provisioned it, and what
 * stands above it is not this reader's to answer for. The read past it keeps
 * the one ENOENT arm the leaf still needs — its directory is proven by then,
 * so that errno is the artifact's own.
 */
function inTree(cwd: string): (path: string) => string | null {
  return (path) => {
    const full = join(cwd, path);
    if (!isDirectoryOrAbsentUnder(TREE_SUBJECT, cwd, dirname(full))) return null;
    try {
      return readFileSync(namespacedJoin(full), "utf8");
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
 * A state root outside the repo tree has no path in any commit, so the notes
 * the prompt would name are ones the records gate cannot admit and the park
 * and continuation predicates cannot read back — the channel build's prompt
 * promises is not there. The engine reports that case as an absent `stateRootRel`; refused
 * here rather than rendered as a path that silently writes nowhere the tick's
 * commit reaches (*Loud or nothing*).
 *
 * The offset the engine does report is already git's alphabet
 * (`computeStateRootRel`, `src/paths.ts`), which is what the note this
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
