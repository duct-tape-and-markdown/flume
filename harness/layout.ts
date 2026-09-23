/**
 * Where every plan artifact sits under a state root — the queue, the plan
 * state, the questions directory, the record queues and build's two notes —
 * and the fence that is their list (`spec/harness.md`, *Committed-path discipline*:
 * every mechanic the package wires addresses a path some commit holds).
 *
 * **One home, because five surfaces address one layout.** The chain factory
 * fences these paths, `init.ts` seeds them, `gates.ts` decides whether a
 * commit's touched path is one of them, the slice prompts name them for the
 * agent that writes them, and the accessors beside this module read and write
 * their bytes. A path spelled at any of those is a rename away from a fence
 * admitting a file nobody writes, or a gate guarding a path nobody reads
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * This module is the layout alone — names and nothing else. What an artifact
 * *holds* belongs to whatever reads it: the plan state's fields to
 * `planState.ts`, a record's cap and title line to `records.ts` and the gate
 * that judges one, a rendered path's prompt slot to `prompts.ts`.
 *
 * Every path here is **relative to a state root the caller supplies**,
 * because the same layout is addressed two ways: repo-relative (`.flume`)
 * where a git path or a fence glob is wanted, and absolute (the engine's
 * `flumeDir`) where disk is read. The package hardcodes neither — a
 * consumer's state root is wherever its declaration sits.
 *
 * **These names answer in git's alphabet**, since what they are for is a
 * diff-tree line, a pathspec, a fence glob. A consumer that means to read
 * disk folds them to the host's separator at its fs call —
 * `recordFiles` (`harness/records.ts`) is the listing that must, and it
 * composes with `node:path` from {@link RECORD_DIR_NAMES} rather than
 * converting a name from here.
 */

import { gitPath, resolvePendingPath } from "../src/paths.js";

/**
 * A path under a state root, in git's alphabet — the join every name spelled
 * below is placed under a root by, and the one a caller holding a
 * state-root-relative path of its own reaches for.
 *
 * The tail is folded rather than trusted. Most callers pass a constant spelled
 * here with forward slashes, for which this is a plain join; a caller holding
 * a relative path the *host* composed — `relative()` against a resolved queue,
 * in `gates.ts` — arrives with the host's separator, and a backslash in a
 * pathspec matches nothing on win32 (`gitPath`, `src/paths.ts`). Folding at
 * the one join is what keeps that from being a rule each caller remembers.
 *
 * The **root** is passed through untouched: an absolute win32 state root is a
 * path this package did not choose, and rewriting a caller's root into git's
 * alphabet would hand back a spelling no `join`-built path matches.
 */
export function underStateRoot(stateRoot: string, rel: string): string {
  return `${stateRoot}/${gitPath(rel)}`;
}

/** Where the plan state artifact sits under a state root. */
const PLAN_STATE_REL = "plan/state.json";

/**
 * The questions directory's name under a state root — the directory a plan
 * slice's questions block lists and a session adds a file to.
 */
export const QUESTIONS_DIR_REL = "plan/questions";

/**
 * The extension an open question carries. A question is markdown a human
 * reads; a `.gitkeep` holding an otherwise-empty directory in a consumer's
 * tree is not a question and must not read as one still open.
 */
export const QUESTION_EXT = ".md";

/**
 * Where the single page open questions were sections of sat, before they
 * were one file each.
 *
 * **A migration allowance, and the only reason it is still spelled.** No
 * slice renders it and nothing writes it; it rides {@link planArtifacts} so
 * that the drain which moves a consumer's open questions into
 * {@link questionsDir} can `git rm` the page in the same commit — outside
 * the fence, that page is a file no phase can reach and every plan tick
 * reverts on. Retired by the maintainer cutting the release after
 * `docs/MIGRATING-0.17.md`, whose migration section is what tells consumers
 * to take the drain; this constant, its accessor and its fence line go with
 * it in that commit.
 */
const LEGACY_QUESTIONS_REL = "plan/open-questions.md";

/** Where a build tick's observation to plan sits under a state root. */
const NOTES_REL = "plan/notes";

/**
 * Where a build tick's **park** sits — one segment below the observations,
 * because a note that parks its entry says so by where it sits and by
 * nothing else (`spec/harness.md`, *Records as one file each*: location is
 * kind). The two share a parent so that one ignore rule, one listing and one
 * operator's `ls` still reach every note a build wave wrote.
 */
const PARKED_NOTES_REL = `${NOTES_REL}/parked`;

/**
 * Both homes a build note has, in the order a listing names them:
 * observations, then parks. The one spelling of the pair — {@link noteGlobs}
 * and {@link notePaths} compose from here, and {@link RECORD_DIR_NAMES}
 * carries it — so a third home added here reaches the fence, the listing and
 * the gate together rather than one at a time.
 */
const NOTE_DIR_RELS = [NOTES_REL, PARKED_NOTES_REL] as const;

/**
 * The record directories' names under a state root, in the order
 * `.flume/PROTOCOL.md`, *Records: one file each* lists them: findings from
 * the field, then build ticks' notes, one directory per kind. The one
 * spelling — {@link recordDirs}, {@link recordGlobs} and `recordFiles`
 * (`harness/records.ts`) each compose from here, in this order, rather than
 * each walking its own list. They differ only in the separator they join
 * with, never in which directories exist or in what order they are named.
 *
 * The parked directory rides it like any other: a park is a record, so the
 * drain lists it, the plan fence admits its deletion, and the records gate
 * holds it to the same two rules.
 */
export const RECORD_DIR_NAMES = ["inbox", ...NOTE_DIR_RELS] as const;

/**
 * The extension a record carries. A record is markdown a human reads; a
 * `.gitkeep` or an editor's swap file in a record directory is not a record
 * and must not hold the inbox window open.
 */
export const RECORD_EXT = ".md";

/** Every record in a directory, as a fence glob matches one. */
const RECORD_GLOB = `*${RECORD_EXT}`;

/**
 * The queue's path under a state root, in git's alphabet — what the plan
 * fence admits and what `init.ts` reports having seeded.
 *
 * Addressed through the engine's own resolver rather than spelled here: the
 * dispatcher, `flume check` and `flume status` all reach the queue through
 * `resolvePendingPath`, and a second spelling would fence a file none of them
 * reads. That resolver composes with `node:path`, so the fold back into git's
 * alphabet lives here once rather than at each caller. The fold covers the
 * composed path, which leaves a root already in git's alphabet — the one the
 * engine reports — exactly as it arrived.
 *
 * A caller wanting the queue as **disk** holds it calls that resolver
 * directly: it already answers host-native, which is what a prompt naming a
 * file for an agent to open, and every fs call on it, wants.
 */
export function queuePath(stateRoot: string): string {
  return gitPath(resolvePendingPath(stateRoot));
}

/**
 * Where the plan state artifact lives under `stateRoot`. One spelling, so the
 * fence admitting the artifact and the accessor reading it cannot name
 * different files.
 */
export function planStatePath(stateRoot: string): string {
  return underStateRoot(stateRoot, PLAN_STATE_REL);
}

/**
 * Where open questions live — one file each, present while open
 * (`spec/harness.md`, *Records as one file each*).
 *
 * Three readers share it — the questions listing `questions.ts` renders for
 * every plan slice, the path those prompts name for a question a tick adds,
 * and the fence the chain factory hands every plan slice as
 * {@link questionGlob}. A second spelling anywhere is a slice writing a
 * question where the next slice does not look, or a fence that reverts the
 * commit carrying it.
 */
export function questionsDir(stateRoot: string): string {
  return underStateRoot(stateRoot, QUESTIONS_DIR_REL);
}

/**
 * The questions directory as a fence glob — what admits the file a tick
 * opening a question writes, and the file a tick answering one deletes.
 */
export function questionGlob(stateRoot: string): string {
  return `${questionsDir(stateRoot)}/*${QUESTION_EXT}`;
}

/**
 * The legacy questions page under a state root ({@link LEGACY_QUESTIONS_REL})
 * — addressable so a drain can delete it, and for nothing else.
 */
export function legacyQuestionsPath(stateRoot: string): string {
  return underStateRoot(stateRoot, LEGACY_QUESTIONS_REL);
}

/**
 * Every record directory under `stateRoot` — the form a git path, a diff-tree
 * line and a fence glob are all in. What a caller matching commit paths wants
 * is {@link recordGlobs}, never a prefix test over these.
 */
export function recordDirs(stateRoot: string): string[] {
  return RECORD_DIR_NAMES.map((name) => underStateRoot(stateRoot, name));
}

/**
 * Every record under `stateRoot` as a fence glob, one per record directory —
 * and the one test of whether a commit's touched path *is* a record.
 *
 * Two readers, one derivation: the plan fence below, and the records gate
 * asking which of a commit's paths it has to judge (`gates.ts`). A prefix
 * test spelled at either would read a file under an `inbox-archive` sibling
 * as an inbox record, and — one record directory sitting inside another —
 * would read a note under the parked directory as a record of the directory
 * above it, which is the one distinction the layout exists to carry. The
 * matcher's `*` stops at the separator, so each glob claims exactly its own
 * directory's own records.
 */
export function recordGlobs(stateRoot: string): string[] {
  return recordDirs(stateRoot).map((dir) => `${dir}/${RECORD_GLOB}`);
}

/**
 * Where a build tick's observation to plan lives — `<stateRoot>/plan/notes`.
 * The fence globs build's phase declares are {@link noteGlobs}, so the fence
 * and the paths below cannot name different directories.
 */
export function notesDir(stateRoot: string): string {
  return underStateRoot(stateRoot, NOTES_REL);
}

/**
 * Where a build tick's park lives — the directory under {@link notesDir} that
 * *is* the park signal.
 */
export function parkedNotesDir(stateRoot: string): string {
  return underStateRoot(stateRoot, PARKED_NOTES_REL);
}

/**
 * The note a build tick assigned `tag` writes when it has something for the
 * next plan tick and shipped its entry anyway: an observation, under
 * {@link notesDir}.
 *
 * Two readers, one derivation — the records gate admitting a note under this
 * tick's own tag, and the build prompt naming the path a tick writes to. A
 * second spelling anywhere is a tick that writes where the gate does not
 * look.
 *
 * `tag` is interpolated as given: the engine bounds and validates a tag at
 * the queue's schema gate, and re-deriving that check here would be the same
 * guard in two places.
 */
export function notePath(stateRoot: string, tag: string): string {
  return `${notesDir(stateRoot)}/${tag}${RECORD_EXT}`;
}

/**
 * The note a build tick assigned `tag` writes when it cannot ship the entry:
 * its park, under {@link parkedNotesDir}.
 *
 * The same three readers as its sibling plus the one that makes it a park:
 * the park predicate reads exactly this path back out of a commit's touched
 * paths (`chain.ts`), so where a tick wrote is the whole statement and the
 * rest of the commit's shape is not read at all. A second spelling here is a
 * park the chain does not recognize, and an entry that leaves the queue with
 * the work undone.
 */
export function parkedNotePath(stateRoot: string, tag: string): string {
  return `${parkedNotesDir(stateRoot)}/${tag}${RECORD_EXT}`;
}

/**
 * Both notes a build tick assigned `tag` may write, in the order
 * {@link RECORD_DIR_NAMES} names their directories — what the records gate
 * admits from that tick, since which of the two it wrote is the park verdict
 * and not the gate's business.
 */
export function notePaths(stateRoot: string, tag: string): string[] {
  return NOTE_DIR_RELS.map(
    (rel) => `${underStateRoot(stateRoot, rel)}/${tag}${RECORD_EXT}`,
  );
}

/**
 * Build's note directories as fence globs, one per kind — the paths a build
 * tick's fence adds to whatever the consumer declared.
 *
 * Both, always: a tick that could write an observation but not a park would
 * have its refusal reverted by the very fence that was meant to carry it.
 */
export function noteGlobs(stateRoot: string): string[] {
  return NOTE_DIR_RELS.map(
    (rel) => `${underStateRoot(stateRoot, rel)}/${RECORD_GLOB}`,
  );
}

/**
 * Every artifact the package's plan slices own under `stateRoot`, as fence
 * globs — the list the chain factory hands each plan phase, whatever a
 * consumer declared.
 *
 * The record queues ride it because a slice drains a record by deleting its
 * file; the records gate (`gates.ts`) is what refuses a slice that writes one
 * instead.
 *
 * Composed here rather than assembled at the factory out of the modules that
 * happened to hold each name: the fence is the layout's own statement of what
 * the layout is, so an artifact added below joins the fence with it.
 */
export function planArtifacts(stateRoot: string): string[] {
  return [
    queuePath(stateRoot),
    planStatePath(stateRoot),
    questionGlob(stateRoot),
    legacyQuestionsPath(stateRoot),
    ...recordGlobs(stateRoot),
  ];
}
