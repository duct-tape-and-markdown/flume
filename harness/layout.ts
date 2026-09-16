/**
 * Where every plan artifact sits under a state root — the queue, the plan
 * state, the open questions, the record queues and build's note — and the
 * fence that is their list (`spec/harness.md`, *Committed-path discipline*:
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
 * disk folds them to the host's separator at its fs call — {@link
 * recordFiles} (`records.ts`) is the listing that must, and it composes with
 * `node:path` from {@link RECORD_DIR_NAMES} rather than converting a name
 * from here.
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

/** Where the open-questions page sits under a state root. */
const QUESTIONS_REL = "plan/open-questions.md";

/** The build-note directory's name under a state root. */
const NOTES_REL = "plan/notes";

/**
 * The record directories' names under a state root, in the order
 * `.flume/PROTOCOL.md`, *Records: one file each* lists them: findings from
 * the field, then notes from build ticks. The one spelling — {@link
 * recordDirs}, {@link notesDir} and {@link recordFiles} each compose from
 * here, in this order, rather than each walking its own list. They differ
 * only in the separator they join with, never in which directories exist or
 * in what order they are named.
 */
export const RECORD_DIR_NAMES = ["inbox", NOTES_REL] as const;

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
 * The open-questions artifact under a state root.
 *
 * Two readers share it — the slice prompts `prompts.ts` renders, and the
 * fence the chain factory hands every plan slice. A second spelling anywhere
 * is a slice writing a question where the next slice does not look, or a
 * fence that reverts the commit carrying it.
 */
export function questionsPath(stateRoot: string): string {
  return underStateRoot(stateRoot, QUESTIONS_REL);
}

/**
 * Every record directory under `stateRoot` — the form a git path, a diff-tree
 * line and a fence glob are all in. A caller matching commit paths wants a
 * trailing separator on each so `inbox` cannot prefix `inbox-archive`.
 */
export function recordDirs(stateRoot: string): string[] {
  return RECORD_DIR_NAMES.map((name) => underStateRoot(stateRoot, name));
}

/**
 * Where build notes live — `<stateRoot>/plan/notes`. The fence glob build's
 * phase declares is {@link noteGlob}, so the fence and {@link notePath}
 * cannot name different directories.
 */
export function notesDir(stateRoot: string): string {
  return underStateRoot(stateRoot, NOTES_REL);
}

/**
 * The one file a build tick assigned `tag` may write: its note, under
 * {@link notesDir}.
 *
 * Three readers, one derivation — the records gate refusing a note under
 * another tick's tag, the build prompt naming the path a tick writes to, and
 * the park predicate reading back a commit whose only path is this. A second
 * spelling anywhere is a tick that writes where the gate does not look, or a
 * park the chain does not recognize and ships with the work undone.
 *
 * `tag` is interpolated as given: the engine bounds and validates a tag at
 * the queue's schema gate, and re-deriving that check here would be the same
 * guard in two places.
 */
export function notePath(stateRoot: string, tag: string): string {
  return `${notesDir(stateRoot)}/${tag}${RECORD_EXT}`;
}

/**
 * Build's note directory as a fence glob — the one path a build tick's fence
 * adds to whatever the consumer declared.
 */
export function noteGlob(stateRoot: string): string {
  return `${notesDir(stateRoot)}/${RECORD_GLOB}`;
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
    questionsPath(stateRoot),
    ...recordDirs(stateRoot).map((dir) => `${dir}/${RECORD_GLOB}`),
  ];
}
