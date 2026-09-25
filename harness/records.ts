/**
 * The record queue as a tree holds it (`spec/harness.md`, *Records as one
 * file each*) — what a record may weigh, what is waiting to be drained, and
 * whether the inbox slice's record window is open right now.
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
 * which is where the host-native answer and the proof behind that absence
 * are stated. Reading a queue off a *commit* is a second walk of the same
 * shape (`tipPathsUnder`, `harness/gitRange.ts`), because the wake stands
 * where no checkout is. What is left here is which directories, in which
 * order, under which extension — and the {@link RecordTree} seam that says
 * those rules hold whichever walk answered.
 *
 * What a record must *contain* — the title line, whose tag it may carry,
 * that a plan slice drains rather than writes — belongs to the gate that
 * reads these paths.
 */

import {
  fileUnderStateRoot,
  filesCarrying,
  pathsUnderStateRoot,
} from "./dirListing.js";
import { tipPathsUnder } from "./gitRange.js";
import { NOTE_DIR_RELS, RECORD_DIR_NAMES, RECORD_EXT } from "./layout.js";

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
 * Every record waiting in `tree`, at that tree's own spelling and in queue
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
 * What a directory *holds*, and in what alphabet — the absent queue that
 * contributes nothing, the obstructed one that refuses, the host-native
 * paths a checkout answers in against the git-alphabet ones a commit's tree
 * does — is the {@link RecordTree} handed in. All this adds is which
 * directories, in what order, and the three rules below.
 *
 * **A claimed entry's note is withheld, and left where it sits.** `claimed`
 * is the tags a tick read off the claims directory before it selected
 * (`TickContext.claimed`); a note or park under one of them is a file a
 * build tick may be rewriting right now, so the drain does not see it and
 * does not delete it (`spec/pending.md`, *A claim covers the entry's
 * records*). It is not dropped — the claim lifts when the build attempt
 * ends, and the next tick's listing carries the file again. Empty is the
 * reading for a caller with nothing in flight.
 *
 * One listing, two readers: the inbox slice's liveness predicate below asks
 * whether this is empty, and the slice's own window renders these files'
 * bytes. A second walk beside this one is a window that shows a record the
 * predicate did not count, or counts one it does not show
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*) — which is why the withholding is here and
 * not at the render: a slice woken by a note only its holder may touch is a
 * tick with nothing to do.
 */
export function recordFiles(
  tree: RecordTree,
  claimed: readonly string[] = [],
): string[] {
  const withheld = claimedNotes(tree, claimed);
  return RECORD_DIR_NAMES.flatMap((name) =>
    filesCarrying(tree.paths(name), RECORD_EXT),
  ).filter((file) => !withheld.has(file));
}

/**
 * A tree a record queue is read out of: what one of its directories holds,
 * and the spelling this tree names a file in one at.
 *
 * Two of them, because the two readers of one listing stand in different
 * places. The render runs inside a tick's provisioned worktree and reads
 * that checkout ({@link checkoutRecords}); the wake runs at the handoff,
 * which has no worktree of its own, and reads the tip a worktree would be
 * cut from ({@link tipRecords}). Everything above that split — which
 * directories, in what order, under which extension, and which of them a
 * claim withholds — is {@link recordFiles}'s and is applied to whichever
 * tree it was handed, so the two answers can differ in their contents and
 * never in their rules (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 *
 * `rel` is a directory name in git's alphabet, as `layout.ts` spells every
 * name it holds; what comes back is in **this tree's own** alphabet, and
 * {@link file} is how a caller composes a path to compare against one
 * without spelling that alphabet itself.
 */
export interface RecordTree {
  /**
   * Every path directly under `rel`, unfiltered and in any order — the
   * directory's whole contents, for {@link recordFiles} to read.
   */
  paths(rel: string): readonly string[];
  /** The path this tree names `<rel>/<name>` at. */
  file(rel: string, name: string): string;
}

/**
 * The record queue as a **checkout** holds it: the directories under an
 * absolute `stateRoot`, walked on disk and answered host-native
 * (`pathsUnderStateRoot`, `harness/dirListing.ts`, which is where the absent
 * queue, the obstructed one and the host's separator are all decided).
 *
 * What a tick's own prompt is rendered from: the record it is shown must be
 * one it can open, and one its own commit can `git rm` (`spec/pending.md`,
 * *Dispatch reads come from the tip, not the tree*).
 */
export const checkoutRecords = (stateRoot: string): RecordTree => ({
  paths: (rel) => pathsUnderStateRoot("record queue", stateRoot, rel),
  file: (rel, name) => fileUnderStateRoot(stateRoot, rel, name),
});

/**
 * The record queue as the **tip** holds it: the same directories under
 * `stateRootRel`, read out of `repoRoot`'s `HEAD` tree and answered in git's
 * alphabet (`tipPathsUnder`, `harness/gitRange.ts`).
 *
 * What a liveness predicate asks, because a tick's worktree is cut from the
 * tip: a file the shared disk holds and the tip does not is work the woken
 * tick cannot route, and it would wake the slice again after every tick that
 * could not (`spec/harness.md`, *The phases*).
 *
 * No path here is ever opened — the wake counts records, and the tick it
 * wakes renders its own tree's — so the git-alphabet spelling stays git's
 * rather than being folded to the host's for a read nobody makes.
 */
export const tipRecords = (
  repoRoot: string,
  stateRootRel: string,
): RecordTree => ({
  paths: (rel) => tipPathsUnder(repoRoot, `${stateRootRel}/${rel}`),
  file: (rel, name) => `${stateRootRel}/${rel}/${name}`,
});

/**
 * Every note home's file for each claimed tag, at the spelling
 * {@link recordFiles}'s listing hands one back at — the set a drain does not
 * see.
 *
 * Composed from {@link NOTE_DIR_RELS} through the tree's own composer, so a
 * home added to that roster is withheld with the rest and the two sides of
 * the comparison cannot disagree by a separator — whichever tree answered
 * ({@link RecordTree}). The inbox is not among them and
 * needs no exclusion: an operator's finding is named by date and slug, not by
 * an entry's tag, so no claimed tag ever composes a path under it.
 */
function claimedNotes(
  tree: RecordTree,
  claimed: readonly string[],
): ReadonlySet<string> {
  return new Set(
    claimed.flatMap((tag) =>
      NOTE_DIR_RELS.map((rel) => tree.file(rel, `${tag}${RECORD_EXT}`)),
    ),
  );
}

/**
 * Whether any record is waiting to be drained in `tree` — the inbox slice's
 * record leg, true while {@link recordFiles} names anything.
 *
 * Where that listing throws, the window reports **live**: an unreadable
 * queue is a reason to run the tick that drains it, never a reason to skip
 * one. That is a degraded path taken deliberately, and it is bounded — the
 * slice it wakes renders the same listing and fails loudly there rather than
 * proceeding over the unread bytes (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
export function recordsPending(
  tree: RecordTree,
  claimed: readonly string[] = [],
): boolean {
  try {
    return recordFiles(tree, claimed).length > 0;
  } catch {
    return true;
  }
}
