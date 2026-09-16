/**
 * The record queue as disk holds it (`spec/harness.md`, *Records as one file
 * each*) — what a record may weigh, what is waiting to be drained under a
 * state root, and whether the inbox slice's record window is open right now.
 *
 * A record is one file, never a section appended to a shared document: git
 * merges by line position, so two ticks appending to one file conflict
 * whatever the syntax, and two ticks creating two files never do. That is
 * the whole reason these are paths at all, and it is why the directories
 * they sit in are named once, in `layout.ts`, beside every other plan
 * artifact — the records gate deciding whether a commit's touched path is a
 * record, the build fence admitting the note glob, and the build prompt
 * telling a tick where to write all read them from there
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*). This module is the fourth reader: the
 * listing and the liveness predicate below.
 *
 * **That listing answers host-native**, unlike the names it composes from.
 * {@link recordFiles} and {@link recordsPending} take the absolute state
 * root and read disk, so they join through `node:path` (`spec/cli.md`,
 * *win32 is a supported host*, path discipline) rather than taking a
 * git-alphabet directory from `layout.ts` and converting it.
 *
 * What a record must *contain* — the title line, whose tag it may carry,
 * that a plan slice drains rather than writes — belongs to the gate that
 * reads these paths.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { namespacedJoin } from "../src/paths.js";

import { RECORD_DIR_NAMES, RECORD_EXT } from "./layout.js";

/**
 * The cap a record fits, in bytes — what was observed, where, and why it
 * matters, and nothing else.
 *
 * The package's value, not a declaration knob: the discipline the cap
 * enforces is the package's, and a consumer free to raise it would be free
 * to turn the record channel back into the design document the cap exists to
 * refuse.
 *
 * **The drain reports an overrun; no gate reverts one** (`spec/harness.md`,
 * *The gates the discipline needs*). A record over this ships with the
 * commit that wrote it, and the inbox window marks it with its byte count
 * for the drain to name in the plan commit body — so the overrun is loud at
 * the prose channel it belongs to rather than costing the code beside it
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export const RECORD_MAX_BYTES = 1200;

/**
 * Every record waiting under `stateRoot`, as **host-native paths** in queue
 * order: the directories in the order {@link RECORD_DIR_NAMES} lists them,
 * each directory's files sorted by name — an inbox record's name leads with
 * its date, so the order is oldest first.
 *
 * `stateRoot` here is the absolute one, and these paths are read, rendered
 * and compared as filesystem paths rather than handed to git, so they are
 * composed with `node:path` rather than slash-joined like {@link recordDirs}
 * is. A separator appended to an absolute win32 root yields a path fs accepts
 * and nothing else equals: the window would name every record at a spelling
 * no `join`-built path — the one its own reader and every consumer compose —
 * matches.
 *
 * The listing itself goes through `namespacedJoin`, since a record sits
 * under a chain-declared state root and a note's name is an entry's tag
 * (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component*). The names handed back stay plain: they
 * are what a prompt renders and a human opens, and the extended-length
 * prefix belongs at the fs call, not in the queue's vocabulary.
 *
 * One listing, two readers: the inbox slice's liveness predicate below asks
 * whether this is empty, and the slice's own window renders these files'
 * bytes. A second walk beside this one is a window that shows a record the
 * predicate did not count, or counts one it does not show
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * A missing directory contributes nothing: an empty queue and an absent one
 * are the same fact, and a consumer that has never had a record should not
 * have to create a directory to say so. Every **other** listing failure
 * throws — a caller here is about to read these bytes, and a queue that
 * silently lost a record is a finding that never reaches the slice draining
 * it (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Synchronous by its callers' contract: a slice's liveness predicate is pure
 * over its inputs and runs on the selection path, and these are two small
 * directory listings.
 */
export function recordFiles(stateRoot: string): string[] {
  return RECORD_DIR_NAMES.flatMap((name) => {
    const dir = join(stateRoot, name);
    let names: string[];
    try {
      names = readdirSync(namespacedJoin(dir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return names
      .filter((entry) => entry.endsWith(RECORD_EXT))
      .sort()
      .map((entry) => join(dir, entry));
  });
}

/**
 * Whether any record is waiting to be drained under `stateRoot` — the inbox
 * slice's record leg, true while {@link recordFiles} names anything.
 *
 * Where that listing throws, the window reports **live**: an unreadable
 * queue is a reason to run the tick that drains it, never a reason to skip
 * one. That is a degraded path taken deliberately, and it is bounded — the
 * slice it wakes renders the same listing and fails loudly there rather than
 * proceeding over the unread bytes (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
export function recordsPending(stateRoot: string): boolean {
  try {
    return recordFiles(stateRoot).length > 0;
  } catch {
    return true;
  }
}
