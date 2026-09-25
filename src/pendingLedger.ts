/**
 * The pending ledger's I/O: the queue directory's listing, every way a tick
 * reads the entry files under it, the queue a gate's own commit holds, the
 * chain-less read a CLI verb counts through, the relocation check those reads
 * turn on, the fence verdict that decides whose read may survive a parse
 * failure, and the one rewrite that retires what a wave shipped.
 *
 * Calls that share one fact each — where the ledger lives, which
 * alphabet it is read out of, and whether git can see it at all — so they
 * live in the file their name is rather than split across the class that
 * dispatches a tick and the leg that ships one
 * (`.claude/rules/engineering.md`, *A module is one job*). The readers take
 * what they read with (`PendingLedgerContext`) rather than reaching for a
 * field on either caller, the same way one attempt takes an `AttemptContext`
 * (`src/tickAttempt.ts`) and either leg takes a `TickLegContext`
 * (`src/tickLeg.ts`, which extends the context below).
 *
 * Nothing here interprets what it read. The strict reader refuses, the
 * decide-read hands the refusal to the queue's own writer as a fact, the
 * tolerant one announces and degrades, and the rewrite reports the sha, the
 * tip verdict it got, and where the queue it was moving stands — what a tick
 * does about any of it stays with the dispatcher (`src/Dispatcher.ts`) and the
 * wave (`src/waveMerge.ts`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { isDirectoryOrAbsentUnder } from "./fsProbe.js";
import type { GateContext } from "./Gate.js";
import * as git from "./git.js";
import type { Logger } from "./log.js";
import { escapesRoot, gitPath, matchesAny, namespacedJoin } from "./paths.js";
import {
  ENTRY_FILE_EXT,
  entryFileName,
  parsePendingQueue,
  parsePendingQueueLoose,
  PendingParseFailure,
} from "./PendingSchema.js";
import type {
  EntryExtension,
  ParseResult,
  PendingEntry,
  QueueFile,
  QueueParseFailure,
} from "./PendingSchema.js";
import type { Phase } from "./Phase.js";
import type { TickVerdictMergeOutcome } from "./tickVerdict.js";
import { liveForeignClaimPid } from "./tipVerify.js";

/**
 * What the ledger's reads and its one rewrite take from whoever calls them:
 * the repo whose tip a read resolves against, the ledger's own resolved
 * path, the chain's declared entry extension every parse composes, the
 * logger a degraded read announces through, and the two knobs the rewrite's
 * commit takes.
 *
 * Both callers already hold all seven, so nothing here is re-derived from disk
 * and no read can run against a path resolved before this tick's chain load
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
export interface PendingLedgerContext {
  readonly repoRoot: string;
  /**
   * The mutable-state root: baton, pending ledger, worktrees, prior-attempt
   * records. Here because it is the root a disk read of the queue descends
   * from ({@link readQueueOnDisk}) — the outermost directory the caller
   * answers for, whether or not it sits inside the repo.
   */
  readonly flumeDir: string;
  /** The pending ledger directory's resolved path, as this tick's chain declared it. */
  readonly pendingDir: string;
  /**
   * The chain's declared entry extension, composed into every parse below —
   * `undefined` where the chain declares none, which is core shape alone.
   */
  readonly entryExtension: EntryExtension | undefined;
  readonly log: Logger;
  /** This run's own tip claim pid, so its own claim never reads as foreign (`src/tipVerify.ts`). */
  readonly ownTipClaimPid?: number;
  /** The chain's override for the pending-ledger commit message, if it declared one. */
  readonly commitMessage?: (
    shippedTags: readonly string[],
    footprintTags: readonly string[],
  ) => string;
}

/**
 * Whether `pendingDir` sits outside `repoRoot` — an out-of-tree state
 * root's ledger, invisible to git by construction. Shared by
 * {@link readPending}'s tip-vs-disk choice and {@link commitPendingUpdate}'s
 * commit-vs-disk-only choice: one relocation check, not two independently
 * re-derived ones. Delegates to the escape check `escapesRoot`
 * (`src/paths.ts`) owns rather than re-deriving it
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*), which
 * is the same verdict `computeStateRootRel` (`src/paths.ts`) reports the
 * state root under — `pendingDir` being a descendant of that root
 * (`resolvePendingDir`, `src/paths.ts`), the two always agree.
 */
export function isPendingRelocated(ctx: PendingLedgerContext): boolean {
  return escapesRoot(ctx.repoRoot, ctx.pendingDir);
}

/**
 * The ledger directory's path relative to the repo root **in git's own
 * alphabet** ({@link gitPath}), or `undefined` when it is relocated outside
 * that root and git cannot name it at all.
 *
 * The fold lands here, at the one reporter, for the reason
 * `computeStateRootRel` (`src/paths.ts`) folds its own: every consumer
 * composes a value git will read — a tree listing at a ref ({@link
 * readQueueAtRef} below) or a declared fence glob ({@link
 * writesPendingLedger}) — and `relative` answers in the host's dialect, so
 * reporting it raw puts one consumer in the other alphabet on win32 the first
 * time one forgets.
 */
function pendingDirRel(
  ctx: PendingLedgerContext,
): string | undefined {
  if (isPendingRelocated(ctx)) return undefined;
  return gitPath(relative(ctx.repoRoot, ctx.pendingDir));
}

/**
 * One entry file's path relative to the repo root, in git's alphabet — the
 * spelling a fence glob is matched against and a pathspec is composed from.
 *
 * Composed here rather than at each caller, and with `/` rather than
 * `node:path`: the directory half already came out of {@link pendingDirRel}
 * in git's alphabet, and rejoining it through the host's separator is the
 * fold undone (`.claude/rules/posture-sweep.md`, *A repo-relative path
 * composed with `node:path`*).
 */
function entryFileRel(dirRel: string, file: string): string {
  return `${dirRel}/${file}`;
}

/**
 * The ledger directory's path **as a report spells it**: git's own alphabet
 * relative to the repo root wherever git can name it ({@link pendingDirRel}),
 * and the absolute path when a relocated dock puts it where git cannot. Every
 * report this module makes about the queue — the rewrite's result, the refusal
 * it throws, and each degrade {@link readPendingTolerant} announces — takes
 * its spelling from here, so no report composes a second one out of
 * `pendingDir` with `node:path` and none spells the queue by the directory
 * name this chain's declaration was free not to use
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*).
 */
function reportedPendingDir(ctx: PendingLedgerContext): string {
  return pendingDirRel(ctx) ?? ctx.pendingDir;
}

/**
 * Whether `phase` is the writer of the entry files named in `files` — its
 * declared {@link Phase.writablePaths} admit every one of them, read through
 * the same `matchesAny` the write guard enforces the fence with, so the
 * carve-out and the enforcement cannot disagree about what a glob covers.
 *
 * Per file, not per directory: the fence a producer declares over a queue of
 * one file each is a glob (`plan/pending/*.json`), which the directory's own
 * path does not match, and the repair the carve-out exists for is a write to
 * the files that did not parse.
 *
 * Keyed on the **declared** fence and nothing else
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*): the chain said
 * which paths this phase may write, so the engine reads that statement rather
 * than guessing from a phase's name, its prompt, or what its last commit
 * touched. A relocated ledger ({@link pendingDirRel}) is no phase's writer
 * here — `writablePaths` is repo-relative by declaration, so no glob a chain
 * can write names a path outside the repo.
 */
function writesPendingLedger(
  ctx: PendingLedgerContext,
  phase: Pick<Phase, "writablePaths">,
  files: readonly string[],
): boolean {
  const rel = pendingDirRel(ctx);
  if (rel === undefined || files.length === 0) return false;
  return files.every((file) =>
    matchesAny(entryFileRel(rel, file), phase.writablePaths),
  );
}

/**
 * The subject {@link readQueueOnDisk}'s descent names when it refuses
 * (`isDirectoryOrAbsentUnder`, `src/fsProbe.ts`) — one spelling, so the rung
 * an operator is told to go fix reads the same whichever ancestor was
 * obstructed. Not {@link reportedPendingDir}: that names *which* queue a
 * report is about, while this names *what* the unreadable thing is, and the
 * refusal already carries the obstructed path itself.
 */
const QUEUE_SUBJECT = "pending queue";

/**
 * The queue directory's listing on disk, each entry file read: every
 * `*.json` **directly** under `dir` and nothing else (`spec/pending.md`,
 * *The ledger is a directory — one entry per file*). `null` when the
 * directory is absent, which is nothing pending.
 *
 * Subdirectories are dropped rather than walked, so a chain may keep sidecars
 * beside the entries — a `.gitkeep` holding the directory in a tree, a
 * scratch folder — without the engine reading either as work.
 *
 * Absence is the only silent reading. Every other failure throws: a directory
 * that is present but unreachable — a symlink loop, a permission-denied
 * parent — refuses here instead of dispatching this tick over an empty queue
 * (`.claude/rules/engineering.md`, *Loud or nothing*). A `.json` entry that
 * is a symlink is read as the file it is, and a loop under it throws with it.
 *
 * That absence is proven from the **path**, never from the errno the listing
 * raised: a plain file above the queue is `ENOENT` on win32 and `ENOTDIR` on
 * posix (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so an errno-keyed silent arm dispatches one
 * host's tick over an obstructed queue as though nothing were planned. So the
 * same descent `PriorAttemptStore.readAll` and `readMergingMarkers` run
 * ({@link isDirectoryOrAbsentUnder}, `src/fsProbe.ts`), from `stateRoot` down
 * to `dir`; the listing past it keeps no absent arm of its own, because every
 * ancestor is proven by then. `stateRoot` is where the descent starts: the
 * caller declared it, and what stands above it is the caller's to answer for.
 *
 * Names are sorted so two hosts' directory orders cannot produce two
 * listings; what a selection picks in is the queue's declared order, applied
 * at its own home (`byQueueOrder`, `src/selection.ts`).
 */
export function readQueueOnDisk(
  stateRoot: string,
  dir: string,
): QueueFile[] | null {
  if (!isDirectoryOrAbsentUnder(QUEUE_SUBJECT, stateRoot, dir)) return null;
  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  const listing = readdirSync(namespacedJoin(dir), { withFileTypes: true });
  return listing
    .filter((d) => !d.isDirectory() && d.name.endsWith(ENTRY_FILE_EXT))
    .map((d) => d.name)
    .sort()
    .map((file) => ({
      file,
      raw: readFileSync(namespacedJoin(dir, file), "utf8"),
    }));
}

/**
 * The queue directory's listing **as of a commit**, each entry file read out
 * of that commit's tree: {@link readQueueOnDisk}'s at-ref twin, and `null`
 * for the same fact — the directory is not in that tree.
 *
 * `dirRel` is repo-relative in git's own alphabet; both legs hand it to git
 * unchanged. A **gate** asking what queue the commit it is attached to holds
 * asks {@link readGatedQueue} below rather than this: which ref, which
 * offset, and what a relocated root reads instead are that question's facts,
 * and a gate composing them is one divergence from judging a queue the gate
 * beside it never parsed (`.claude/rules/engineering.md`, *A fact the engine
 * holds is reported, never rediscovered*).
 */
export async function readQueueAtRef(
  repoRoot: string,
  ref: string,
  dirRel: string,
): Promise<QueueFile[] | null> {
  const names = await git.listTreeBlobNames(repoRoot, ref, dirRel);
  if (names === null) return null;
  const files = names.filter((name) => name.endsWith(ENTRY_FILE_EXT)).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      // Present in the listing a moment ago and the ref does not move, so a
      // null here is a tree that changed under the read — reported as the
      // empty file it then is, and refused by the parse rather than silently
      // skipped.
      raw:
        (await git.readFileAtRef(repoRoot, ref, entryFileRel(dirRel, file))) ??
        "",
    })),
  );
}

/**
 * What {@link readGatedQueue} reads a gated commit's queue with — the five
 * resolved values every {@link GateContext} already carries, so a gate hands
 * its own context straight in and nothing here is re-derived from disk or
 * from the environment (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 */
export type GatedQueueContext = Pick<
  GateContext,
  "repoRoot" | "commitSha" | "stateRootRel" | "flumeDir" | "pendingDir"
>;

/**
 * The queue a gated commit holds: where its directory sits, in each of the
 * two spellings a gate needs, and the entry files that commit carries under
 * it.
 */
export interface GatedQueue {
  /**
   * The queue directory relative to the **state root**, in git's alphabet —
   * the name a gate's message calls the queue by (`plan/pending` by default,
   * and whatever a chain relocated it to otherwise).
   */
  readonly rel: string;
  /**
   * The same directory relative to the **repo root**, in git's alphabet —
   * what a pathspec or a touched-path comparison is composed from — and
   * `undefined` for a state root relocated outside the repo, which no commit
   * can name at all.
   */
  readonly dirRel: string | undefined;
  /**
   * The entry files as that commit holds them, sorted, each already read; or
   * `null` for no readable queue — absent from the commit's tree, or, on the
   * relocated root's disk leg, present and unreadable. A gate refuses on
   * `null` rather than judging the empty queue it is not
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  readonly files: QueueFile[] | null;
}

/**
 * The one read of {@link GatedQueue} — what `pendingGate`
 * (`src/builtinGates.ts`) judges and what a chain's own gate judges through
 * the seam that reports it (`FlumeApi.readGatedQueue`, `src/flumeApi.ts`).
 * Two gates on one commit read one queue, or the divergence is a gate
 * refusing over a listing the gate beside it passed
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * `spec/pending.md`, *Dispatch reads come from the tip, not the tree*: the
 * files come out of the gated commit's own tree, never the working tree — a
 * disk read here would see trunk's queue even while gating a commit that has
 * not merged to trunk yet.
 *
 * Keyed by `ctx.stateRootRel`, the state root's offset from the *primary*
 * repo root (`spec/chain.md`, *What a gate receives*), never by rebasing
 * `ctx.flumeDir` onto `ctx.repoRoot`: under an `afterCommit` gate
 * `ctx.repoRoot` is a worktree that mirrors the primary checkout's tracked
 * layout at that same offset, while `ctx.flumeDir` is the primary checkout's
 * own state root and is never nested under the worktree — `relative` between
 * the two climbs out through the worktree root whether or not the state root
 * is actually relocated, misreading every real `afterCommit` tick as
 * relocated and falling back to the primary checkout's on-disk (pre-commit)
 * copy.
 *
 * Absent `stateRootRel` — a genuinely relocated state root — has no shared
 * tracked history to read the gated commit's copy out of, so it reads the
 * disk instead: the same branch, for the same fact, that {@link
 * readQueueFiles} takes for a dispatch read. Its throw folds
 * into the `null` the reader already carries for an absent queue: a gate's
 * verdict on either is the same refusal, and the fold is stated here rather
 * than caught twice by the callers.
 *
 * The offset and the queue's own leg are folded once, here, rather than at
 * each reader: `relative` answers in the host's dialect and every consumer of
 * these two values hands them to git — a tree listing at a ref, a
 * touched-path comparison, a message naming a path an operator greps for —
 * where a backslash matches nothing (`.claude/rules/posture-sweep.md`, *A
 * repo-relative path composed with `node:path`*).
 */
export async function readGatedQueue(
  ctx: GatedQueueContext,
): Promise<GatedQueue> {
  const rel = gitPath(relative(ctx.flumeDir, ctx.pendingDir));
  if (ctx.stateRootRel === undefined) {
    let files: QueueFile[] | null;
    try {
      files = readQueueOnDisk(ctx.flumeDir, ctx.pendingDir);
    } catch {
      files = null;
    }
    return { rel, dirRel: undefined, files };
  }
  // Both halves are in git's alphabet already — the offset as the engine
  // reports it, the leg as folded above — so this is a plain join.
  const dirRel = `${ctx.stateRootRel}/${rel}`;
  return {
    rel,
    dirRel,
    files: await readQueueAtRef(ctx.repoRoot, ctx.commitSha, dirRel),
  };
}

/**
 * The listing this tick reads the queue out of: the committed tip's, or the
 * disk's for a relocated dock git cannot see.
 *
 * spec/pending.md "Dispatch reads come from the tip, not the tree": resolves
 * the committed `HEAD` tip, never the working tree — a mid-wave merge, an
 * engine revert, or an operator's staged edit can each leave the tree ahead
 * of or behind the branch, and a dispatch decision must never act on state no
 * commit owns. An out-of-tree `pendingDir` (a relocated state root) has no
 * tip to read — invisible to git by construction ({@link
 * commitPendingUpdate}) — so it stays the one disk-reading case here,
 * alongside {@link readPendingTolerant}.
 */
async function readQueueFiles(
  ctx: PendingLedgerContext,
): Promise<QueueFile[] | null> {
  if (isPendingRelocated(ctx)) return readQueueOnDisk(ctx.flumeDir, ctx.pendingDir);
  // Non-relocated by the branch above, so the fold always answers.
  return readQueueAtRef(ctx.repoRoot, "HEAD", pendingDirRel(ctx)!);
}

/**
 * Strict reader: throws {@link PendingParseFailure} on a parse error rather
 * than degrading to `[]`. Used at every read a tick acts on — the
 * singleton/fanout decide-reads and {@link commitPendingUpdate}'s rewrite
 * read (`.claude/rules/engineering.md`, *Loud or nothing*: a decision or a
 * rewrite must never derive from an input that failed to resolve).
 * {@link readPendingTolerant} below is the one declared exception, for the
 * two report-only reads.
 *
 * An absent directory reads as nothing pending, which is what it is: a tree
 * holds no empty directory, so a queue drained to nothing and a queue never
 * created are one state and neither is an error.
 */
async function readPending(
  ctx: PendingLedgerContext,
): Promise<PendingEntry[]> {
  const files = await readQueueFiles(ctx);
  if (files === null) return [];
  const r = parsePendingQueue(files, ctx.entryExtension);
  if (!r.ok) throw new PendingParseFailure(reportedPendingDir(ctx), r.errors);
  return r.entries;
}

/**
 * Tolerant twin of {@link readPending}, kept only for
 * `TickResult.pendingAfter` — an informational re-read taken after this
 * tick's own strict decide- or rewrite-read already ran (and, for the fanout
 * wave, after any shipped work already landed on trunk). A parse failure
 * here means something outside this tick corrupted a file in the gap
 * between that strict read and now; degrading to `[]` is bounded because
 * `pendingAfter` — and the `TickResult.pickableAfter` derived from it —
 * feeds only the handoff's advisory read of what is pickable next, never a
 * rewrite or a work decision (`.claude/rules/engineering.md`, *Loud or
 * nothing*: the degraded-but-proceeding path, declared and cited at its two
 * call sites).
 *
 * Every way this read can fail degrades the same declared way — announced,
 * then `[]`. It cannot refuse the way {@link readPending} does: it runs after
 * the tick's work has already landed, so a throw here would lose the
 * `TickResult` that describes it. The tolerance is in this reader, never in
 * the listing: {@link readQueueOnDisk} still splits absent from unreachable,
 * and the catch below turns that refusal — and any failure of the reads past
 * it — into the warn a silent absent-verdict would have skipped.
 */
export async function readPendingTolerant(
  ctx: PendingLedgerContext,
): Promise<PendingEntry[]> {
  let files: QueueFile[] | null;
  try {
    files = readQueueOnDisk(ctx.flumeDir, ctx.pendingDir);
  } catch (err) {
    // Present but unreachable — a symlink loop, a permission-denied parent, a
    // `.json` entry whose read failed. `readPending`'s strict twin refuses on
    // exactly this; here it is announced and treated as empty, so a
    // drained-looking `pendingAfter` is never the first anyone hears of it.
    // Named through `reportedPendingDir`, like the announcement below it: a
    // chain that docks its ledger elsewhere is told about the queue it
    // declared.
    ctx.log.warn(
      `[flume] ${reportedPendingDir(ctx)} could not be read (${
        (err as Error).message
      }); treating as empty`,
    );
    return [];
  }
  if (files === null) return [];
  const r = parsePendingQueue(files, ctx.entryExtension);
  if (!r.ok) {
    ctx.log.warn(
      `[flume] ${reportedPendingDir(ctx)} failed to parse ` +
        `(${r.errors.length} errors); treating as empty`,
    );
    return [];
  }
  return r.entries;
}

/**
 * What {@link commitPendingUpdate} answers with, and the one place a caller
 * learns where the file it was about to move stands.
 *
 * `path` rides every answer because the two the wave reports to an operator —
 * the tip-claim refusal below and the rewrite that landed — are both about a
 * queue whose location the chain chose, and the caller holds it only as the
 * absolute `pendingDir` it would have to re-fold itself.
 */
export interface PendingRewriteResult {
  /** The tip after the call: the new ship commit, or the tip that never moved. */
  readonly sha: string;
  /**
   * A live foreign tip claim refused the rewrite. Checked before the writes,
   * so nothing on disk moved either: the queue at {@link path} is the one the
   * call read.
   */
  readonly tipMoved: boolean;
  /** The ledger directory's path as a report spells it ({@link reportedPendingDir}). */
  readonly path: string;
}

/**
 * The wave's ledger rewrite: retire what shipped, drain the `blockedBy`
 * gates those tags were holding, record the footprints a failed merge
 * observed, and commit the result.
 *
 * spec/loop.md "Tip verify — one writer per branch, absorption at the
 * merge", "Harness-driven commits carry no expected-tip bookkeeping": no sha
 * comparison — `liveForeignClaimPid`, checked fresh immediately before this
 * function's own harness-driven `commitPaths` call, the wave's other
 * tip-verify site beside `cherryPickRange` (`mergeAttempt`,
 * `src/waveMerge.ts`). Checked before the writes: a refusal here leaves
 * every entry file untouched on disk rather than a write with no commit
 * behind it. No live claim means the rewrite recommits on whatever tip is
 * current — its content derives from the wave's own outcomes, never from a
 * recorded tip.
 *
 * That ordering is what splits the two refusals' reports. The claim refuses
 * before the writes, so {@link PendingRewriteResult} says the queue is the one
 * this call read; the commit refuses after them, so the throw names the queue
 * the rewrite is standing at, uncommitted. Neither leaves the caller to work
 * out which happened from a file's own mtime.
 */
export async function commitPendingUpdate(
  ctx: PendingLedgerContext,
  shippedTags: string[],
  mergeOutcomes: readonly TickVerdictMergeOutcome[],
  partitionIgnore: string[],
): Promise<PendingRewriteResult> {
  // Footprint content sources from the wave's own TickVerdict
  // record (mergeOutcomes) rather than a separately maintained map — a
  // view over the same facts `tick()` persists, not a second capture.
  // spec/pending.md "Fanout partition — disjoint touched paths": the
  // footprint recorder filters through the same partitionIgnore list the
  // partition itself reads `touchedPaths` through, so observedFiles never
  // grows with a path the partition would drop anyway.
  // A tagless row is a singleton phase's own span, which keys no ledger
  // entry and never reaches this rewrite — skipped by the same predicate
  // that skips a footprintless row.
  const observed = new Map(
    mergeOutcomes.flatMap((m) =>
      m.entryTag && m.footprint && m.footprint.length > 0
        ? [
            [
              m.entryTag,
              m.footprint.filter((p) => !matchesAny(p, partitionIgnore)),
            ] as [string, string[]],
          ]
        : [],
    ),
  );
  const shipped = new Set(shippedTags);
  // Re-read the queue fresh, right before deriving the rewrite — NOT the
  // tick-start snapshot the caller read before provisioning worktrees and
  // running agents. A fanout wave's fanned-out agent runs and serial
  // cherry-picks can take long enough for another process (a concurrent tick,
  // a hand fix) to land its own commit to the queue on trunk in the meantime;
  // deriving from the stale snapshot would blindly overwrite that concurrent
  // write with whatever this wave saw at tick start. Sourcing the rewrite
  // from the current committed state at write time means this wave only ever
  // removes the tags it shipped and touches observedFiles/blockedBy for tags
  // it knows about.
  const files = (await readQueueFiles(ctx)) ?? [];
  const parsed = parsePendingQueue(files, ctx.entryExtension);
  if (!parsed.ok) {
    throw new PendingParseFailure(reportedPendingDir(ctx), parsed.errors);
  }
  const rawByFile = new Map(files.map((f) => [f.file, f.raw]));

  // Exactly the shipped entries' files are removed and exactly the entries
  // this wave changed are rewritten; every other file in the directory is
  // left byte-identical, which is what makes two producers' commits merge
  // (`spec/pending.md`, *The ledger is a directory — one entry per file*).
  const removals: string[] = [];
  const writes: { file: string; content: string }[] = [];
  for (const entry of parsed.entries) {
    const file = entryFileName(entry.tag);
    if (shipped.has(entry.tag)) {
      removals.push(file);
      continue;
    }
    // A blockedBy gate naming a tag this wave shipped is resolved HERE,
    // mechanically: this wave just merged and gated that tag, so
    // "did the blocker land" needs no plan tick — the next wave forms
    // without a plan interim. Judgment gates (parked) stay plan's. A
    // multi-parent blockedBy drains one landed tag at a time: the gate
    // only flips to open once every named parent has shipped.
    const next = withObservedFiles(withDrainedGate(entry, shipped), observed);
    // Identity, not a serialization compare: an entry this wave did not
    // change keeps the bytes its producer wrote, formatting included, so the
    // ledger commit never carries a reformat nobody asked for.
    if (next === entry) continue;
    const content = JSON.stringify(next, null, 2) + "\n";
    if (content !== rawByFile.get(file)) writes.push({ file, content });
  }

  // A footprint-only update can be a no-op (same collision, same paths,
  // second time around) — committing an unchanged tree fails, so skip.
  if (removals.length === 0 && writes.length === 0) {
    return {
      sha: await git.revParse(ctx.repoRoot),
      tipMoved: false,
      path: reportedPendingDir(ctx),
    };
  }

  // A relocated flumeDir puts pendingDir outside the repo, where staging
  // it would fatal — after the entries already merged. An out-of-tree dock
  // is invisible to git by construction, so no chore commit is wanted: the
  // disk write alone carries the auto-unblock and observedFiles forward —
  // computed before the tip check below, which only guards the git-commit
  // path this dock never takes.
  const relocated = isPendingRelocated(ctx);

  if (!relocated) {
    // spec/loop.md "Tip verify — one writer per branch, absorption at the
    // merge", re-checked fresh immediately before this function's own commit
    // — the wave's other harness-driven commit besides `cherryPickRange`.
    // Checked before the writes: a refusal here leaves the queue untouched on
    // disk, never a write with no commit behind it. Shipped entries this wave
    // already cherry-picked stay shipped regardless — only the ledger update
    // itself is refused.
    const foreignClaim = await liveForeignClaimPid(
      ctx.repoRoot,
      ctx.ownTipClaimPid,
    );
    if (foreignClaim !== null) {
      return {
        sha: await git.revParse(ctx.repoRoot),
        tipMoved: true,
        path: reportedPendingDir(ctx),
      };
    }
  }

  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(ctx.pendingDir), { recursive: true });
  for (const { file, content } of writes) {
    await writeFile(namespacedJoin(ctx.pendingDir, file), content, "utf8");
  }
  for (const file of removals) {
    // `force` because the tree is a surface two writers share: the tip said
    // this entry exists and an operator may already have deleted the file.
    // What the commit below stages is the removal either way.
    await rm(namespacedJoin(ctx.pendingDir, file), { force: true });
  }
  if (relocated) {
    return {
      sha: await git.revParse(ctx.repoRoot),
      tipMoved: false,
      path: reportedPendingDir(ctx),
    };
  }
  // Scoped to exactly the entry files this rewrite touched — `git add -A`
  // would sweep up untracked worktree metadata and unrelated user changes
  // into the harness's chore commit, and naming the directory would sweep up
  // a sidecar beside the entries.
  const paths = [...removals, ...writes.map((w) => w.file)].map((file) =>
    join(ctx.pendingDir, file),
  );
  const footprintTags = [...observed.keys()];
  const message =
    ctx.commitMessage?.(shippedTags, footprintTags) ??
    (shippedTags.length > 0
      ? `chore(flume): ship ${shippedTags.join(", ")}`
      : `chore(flume): record merge-failure footprints for ${footprintTags.join(", ")}`);
  // The one refusal on this call that is reached **after** the writes, so the
  // only one whose report has a disk state to state: the rewrite is sitting in
  // the tree with no commit owning it. Every cause git refuses this partial
  // commit for — a paused merge or cherry-pick in the primary checkout, a lost
  // `index.lock`, a disk error — leaves those same files there, so the fact is
  // stated off the ordering in hand rather than keyed on which cause it was
  // (`.claude/rules/engine-boundary.md`, *Told, not inferred*). Without it the
  // refusal reaches an operator as git's sentence alone, and the modified
  // queue in `git status` beside it is theirs to attribute
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*). The cause rides `cause` and is quoted in the
  // message, so nothing downstream reconstructs it.
  let sha: string;
  try {
    sha = await git.commitPaths({ cwd: ctx.repoRoot, message, paths });
  } catch (err) {
    throw new Error(
      `the rewritten queue stands on disk at ${reportedPendingDir(ctx)}, ` +
        `uncommitted — the pending-ledger commit refused: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return { sha, tipMoved: false, path: reportedPendingDir(ctx) };
}

/**
 * One entry with the `blockedBy` parents `shipped` just landed struck out —
 * the same entry, by identity, when it names none of them.
 */
function withDrainedGate(
  entry: PendingEntry,
  shipped: ReadonlySet<string>,
): PendingEntry {
  if (entry.gate.kind !== "blockedBy") return entry;
  const remaining = entry.gate.tags.filter((tag) => !shipped.has(tag));
  if (remaining.length === entry.gate.tags.length) return entry;
  return remaining.length === 0
    ? { ...entry, gate: { kind: "open" as const } }
    : { ...entry, gate: { kind: "blockedBy" as const, tags: remaining } };
}

/**
 * One entry with this wave's observed footprint merged into its
 * `observedFiles` — the same entry, by identity, when the wave observed none
 * for it.
 */
function withObservedFiles(
  entry: PendingEntry,
  observed: ReadonlyMap<string, string[]>,
): PendingEntry {
  const obs = observed.get(entry.tag);
  if (!obs || obs.length === 0) return entry;
  return {
    ...entry,
    observedFiles: [...new Set([...(entry.observedFiles ?? []), ...obs])],
  };
}

/**
 * What a decide-read answered with: the queue as the tick will act on it,
 * and — only ever on the queue's own writer — the parse failure that queue
 * did not survive.
 *
 * `queueParseFailure` present means `pending` is `[]` because nothing
 * resolved, never because the queue is drained. The two are told apart by
 * this field and by nothing a reader has to infer from the empty list.
 */
interface DecideRead {
  readonly pending: PendingEntry[];
  readonly queueParseFailure: QueueParseFailure | undefined;
}

/**
 * The decide-read both legs take, and the one carve-out in {@link readPending}'s
 * refusal (spec/pending.md, *Queue reads are strict*).
 *
 * A phase the strict read refuses over cannot be the phase that repairs the
 * queue, so refusing every phase leaves an unparseable queue clearable only by
 * hand — including for the plan phase whose whole output is the rewrite. Here
 * the refusal is keyed on {@link writesPendingLedger}: the phase whose declared
 * fence admits the ledger runs, with the failure handed to it as a tick fact
 * (`TickContext.queueParseFailure`) and an empty queue to derive from; every
 * other phase is refused exactly as before, and the refusal now names the fence
 * verdict that kept it standing rather than leaving the operator to guess why
 * the tick could not repair itself.
 *
 * One home for the carve-out because three reads take it — `runSingleton`
 * (`src/singletonTick.ts`), `runFanout` (`src/waveTick.ts`) and the preview
 * `Dispatcher.render` resolves one call short of the invocation. A copy at any
 * of them is how a preview comes to disagree with the tick it previews
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Only the decide-reads. `commitPendingUpdate`'s rewrite read keeps the bare
 * refusal: it runs after this tick's shipped work already landed, and a rewrite
 * derived from a parse that failed is exactly the destruction the strict read
 * exists to prevent.
 */
export async function readPendingForDecision(
  ctx: PendingLedgerContext,
  phase: Pick<Phase, "name" | "writablePaths">,
): Promise<DecideRead> {
  let pending: PendingEntry[];
  try {
    pending = await readPending(ctx);
  } catch (err) {
    if (!(err instanceof PendingParseFailure)) throw err;
    const rel = pendingDirRel(ctx);
    // The files that did not resolve, which is what a repair writes — every
    // `ParseError` names one (`spec/pending.md`, *The ledger is a directory —
    // one entry per file*), so the fence verdict is over exactly those and
    // never over the whole directory.
    const broken = [...new Set(err.errors.map((e) => e.file))];
    if (!writesPendingLedger(ctx, phase, broken)) {
      throw new PendingParseFailure(
        reportedPendingDir(ctx),
        err.errors,
        rel === undefined
          ? `the ledger is relocated outside the repo root, which no ` +
            `repo-relative fence can name, so '${phase.name}' cannot rewrite it`
          : `'${phase.name}' does not declare ${broken
              .map((file) => entryFileRel(rel, file))
              .join(", ")} writable, so this tick cannot rewrite ` +
            `${broken.length === 1 ? "it" : "them"}`,
      );
    }
    ctx.log.warn(
      `[flume] ${phase.name} declares ${broken.length} unparseable queue ` +
        `file(s) writable; running it over them with the failure as a tick ` +
        `fact (${err.errors.length} error(s))`,
    );
    return {
      pending: [],
      queueParseFailure: { path: rel!, errors: err.errors },
    };
  }
  return { pending, queueParseFailure: undefined };
}

/**
 * Chain-less informational read of the queue directory at `pendingDir`:
 * absent reads as the empty, valid queue (nothing planned is nothing
 * pending); present reads through `parsePendingQueueLoose` (core fields
 * validated, no extension composed — never a write path). Any other read
 * failure (permission denied, a path too long for the platform, …) is
 * rethrown rather than folded into the absent case
 * (`.claude/rules/engineering.md`, "Loud or nothing") — rethrowing leaves the
 * caller to decide how to surface it: `flume status` (`src/cli.ts`) catches
 * it, reports the failure, and exits non-zero rather than printing
 * "pending: 0" over a queue it could not read.
 *
 * The one read on this page that takes bare paths rather than a
 * {@link PendingLedgerContext}: it runs where no chain resolved, which is the
 * whole reason it exists beside the reads that compose a declared extension.
 * `stateRoot` is the root the listing's absence is proven from
 * ({@link readQueueOnDisk}), which this caller holds either way.
 */
export function readPendingLoose(
  stateRoot: string,
  pendingDir: string,
): ParseResult {
  const files = readQueueOnDisk(stateRoot, pendingDir);
  if (files === null) return { ok: true, entries: [], errors: [] };
  return parsePendingQueueLoose(files);
}
