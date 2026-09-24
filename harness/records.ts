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
 * record or a note, the build fence admitting a note of any kind, and the
 * build prompt telling a tick where to write all read them from there
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*). This module is the fourth reader: the
 * queue's order and the liveness predicate below.
 *
 * **Walking a queue directory is not this module's job either.** A record
 * queue and the questions directory are one shape — a directory of
 * same-extension files whose absence is an empty answer and whose
 * obstruction is a refusal — so one walk serves both (`dirListing.ts`),
 * which is where the host-native answer, the extension filter and the proof
 * behind that absence are stated. What is left here is which directories,
 * in which order.
 *
 * What a record must *contain* — the title line, whose tag it may carry,
 * that a plan slice drains rather than writes — belongs to the gate that
 * reads these paths.
 */

import { listUnderStateRoot } from "./dirListing.js";
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
 *
 * 2,000 rather than the 1,200 it opened at: a record carrying its measured
 * evidence — the shas it verified, the file and line, the one command that
 * reproduces it — ran 1,200 to 1,350 bytes in practice and was trimmed of
 * exactly that evidence to fit. This admits the evidence and still refuses a
 * design document.
 */
export const RECORD_MAX_BYTES = 2000;

/**
 * Every record waiting under `stateRoot`, as **host-native paths** in queue
 * order: the directories in the order {@link RECORD_DIR_NAMES} lists them —
 * the inbox, build's observations, then build's parks — each directory's
 * files sorted by name, and an inbox record's name leads with its date, so
 * the order is oldest first.
 *
 * A directory nested inside another contributes only its own records: the
 * listing filters on the record extension, so the parked directory's *name*
 * is not a record of the directory above it, and its files are named once,
 * under the directory they sit in.
 *
 * **Build's continuing notes are not in it**, and that is the layout's
 * statement rather than a filter here: a continuation is addressed to build's
 * own next tick on the entry, so it is a note home {@link RECORD_DIR_NAMES}
 * does not name (`spec/harness.md`, *A tick puts work down*). A listing that
 * carried one would wake the drain on a file no plan tick can reconcile, and
 * route it away from the tick it was written for.
 *
 * `stateRoot` here is the absolute one, and every reading of a directory
 * under it — the host-native paths these are rendered, opened and compared
 * as, the absent queue that contributes nothing, the obstructed one that
 * refuses — is `listUnderStateRoot`'s (`harness/dirListing.ts`). All this
 * adds is which directories and in what order, and the subject that
 * refusal names.
 *
 * One listing, two readers: the inbox slice's liveness predicate below asks
 * whether this is empty, and the slice's own window renders these files'
 * bytes. A second walk beside this one is a window that shows a record the
 * predicate did not count, or counts one it does not show
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export function recordFiles(stateRoot: string): string[] {
  return RECORD_DIR_NAMES.flatMap((name) =>
    listUnderStateRoot("record queue", stateRoot, name, RECORD_EXT),
  );
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
