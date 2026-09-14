/**
 * The record conventions the harness package's inbox slice drains
 * (`spec/harness.md`, *Records as one file each*) — where a record lives,
 * what a build note is called, how big a record may be, and whether the
 * record window is open right now.
 *
 * A record is one file, never a section appended to a shared document: git
 * merges by line position, so two ticks appending to one file conflict
 * whatever the syntax, and two ticks creating two files never do. That is
 * the whole reason these are paths at all, and it is why they are named
 * here once. Four surfaces read them — the records gate deciding whether a
 * commit's touched path is a record and whether it is the tick's own, the
 * build fence admitting the note glob, the build prompt telling a tick where
 * to write, and the inbox slice's liveness predicate — and a copy in any of
 * them is a rename away from a gate that guards a file nobody writes
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * Every path here is **relative to a state root the caller supplies**,
 * because the same layout is addressed two ways: repo-relative (`.flume`)
 * where a git path or a fence glob is wanted, and absolute (the engine's
 * `flumeDir`) where disk is read. The package hardcodes neither — a
 * consumer's state root is wherever its declaration sits.
 *
 * This module is the layout alone. What a record must *contain* — the title
 * line, whose tag it may carry, that a plan slice drains rather than writes
 * — belongs to the gate that reads these paths.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The build-note directory's name under a state root. */
const NOTES_REL = "plan/notes";

/**
 * The record directories' names under a state root, in the order
 * `.flume/PROTOCOL.md`, *Records: one file each* lists them: findings from
 * the field, then notes from build ticks. The one spelling — {@link
 * recordDirs}, {@link notesDir} and {@link recordsPending} all compose from
 * here rather than beside it.
 */
const RECORD_DIR_NAMES = ["inbox", NOTES_REL] as const;

/**
 * The extension a record carries. A record is markdown a human reads; a
 * `.gitkeep` or an editor's swap file in a record directory is not a record
 * and must not hold the inbox window open.
 */
const RECORD_EXT = ".md";

/**
 * The cap a record fits, in bytes — what was observed, where, and why it
 * matters, and nothing else.
 *
 * The package's value, not a declaration knob: the discipline the cap
 * enforces is the package's, and a consumer free to raise it would be free
 * to turn the record channel back into the design document the cap exists to
 * refuse. A record over this is refused by the records gate rather than
 * truncated (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export const RECORD_MAX_BYTES = 1200;

/**
 * Every record directory under `stateRoot`, slash-joined — the form a git
 * path, a diff-tree line and a fence glob are all in. A caller matching
 * commit paths wants a trailing separator on each so `inbox` cannot prefix
 * `inbox-archive`.
 */
export function recordDirs(stateRoot: string): string[] {
  return RECORD_DIR_NAMES.map((name) => `${stateRoot}/${name}`);
}

/**
 * Where build notes live — `<stateRoot>/plan/notes`, slash-joined. The fence
 * glob build's phase declares is this plus `/*.md`, so the fence and {@link
 * notePath} cannot name different directories.
 */
export function notesDir(stateRoot: string): string {
  return `${stateRoot}/${NOTES_REL}`;
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
 * Whether any record is waiting to be drained under `stateRoot` — the inbox
 * slice's window, true while either directory holds a `.md` file.
 *
 * Synchronous by its caller's contract: a slice's liveness predicate is pure
 * over its inputs and runs on the selection path, and this is two small
 * directory listings.
 *
 * A missing directory is the drained state — an empty queue and an absent
 * one are the same fact, and a consumer that has never had a record should
 * not have to create a directory to say so. Any **other** failure reports
 * the window live: an unreadable queue is a reason to run the tick that
 * drains it, never a reason to skip one. That is a degraded path taken
 * deliberately, and it is bounded — the slice it wakes reads the directory
 * itself and fails loudly there rather than proceeding over the unread
 * bytes (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function recordsPending(stateRoot: string): boolean {
  for (const name of RECORD_DIR_NAMES) {
    try {
      const names = readdirSync(join(stateRoot, name));
      if (names.some((entry) => entry.endsWith(RECORD_EXT))) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true;
    }
  }
  return false;
}
