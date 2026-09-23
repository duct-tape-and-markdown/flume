/**
 * The pending ledger's I/O: every way a tick reads the queue file, the
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
 * wave (`src/waveTick.ts`).
 */

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

import { existsLoud } from "./fsProbe.js";
import * as git from "./git.js";
import type { Logger } from "./log.js";
import { escapesRoot, gitPath, matchesAny, namespacedJoin } from "./paths.js";
import {
  parsePending,
  parsePendingLoose,
  PendingParseFailure,
} from "./PendingSchema.js";
import type {
  EntryExtension,
  ParseResult,
  PendingEntry,
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
 * Both callers already hold all six, so nothing here is re-derived from disk
 * and no read can run against a path resolved before this tick's chain load
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
export interface PendingLedgerContext {
  readonly repoRoot: string;
  /** The pending ledger's resolved path, as this tick's chain declared it. */
  readonly pendingPath: string;
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
 * Whether `pendingPath` sits outside `repoRoot` — an out-of-tree state
 * root's ledger, invisible to git by construction. Shared by
 * {@link readPending}'s tip-vs-disk choice and {@link commitPendingUpdate}'s
 * commit-vs-disk-only choice: one relocation check, not two independently
 * re-derived ones. Delegates to the escape check `escapesRoot`
 * (`src/paths.ts`) owns rather than re-deriving it
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*), which
 * is the same verdict `computeStateRootRel` (`src/paths.ts`) reports the
 * state root under — `pendingPath` being a descendant of that root
 * (`resolvePendingPath`, `src/paths.ts`), the two always agree.
 */
export function isPendingRelocated(ctx: PendingLedgerContext): boolean {
  return escapesRoot(ctx.repoRoot, ctx.pendingPath);
}

/**
 * The ledger's path relative to the repo root **in git's own alphabet**
 * ({@link gitPath}), or `undefined` when it is relocated outside that root
 * and git can name it at all.
 *
 * The fold lands here, at the one reporter, for the reason
 * `computeStateRootRel` (`src/paths.ts`) folds its own: every consumer
 * composes a value git will read — a pathspec at a ref ({@link readPending}
 * below) or a declared fence glob ({@link writesPendingLedger}) — and
 * `relative` answers in the host's dialect, so reporting it raw puts one
 * consumer in the other alphabet on win32 the first time one forgets.
 */
function pendingPathRel(
  ctx: PendingLedgerContext,
): string | undefined {
  if (isPendingRelocated(ctx)) return undefined;
  return gitPath(relative(ctx.repoRoot, ctx.pendingPath));
}

/**
 * The ledger's path **as a report spells it**: git's own alphabet relative to
 * the repo root wherever git can name the file ({@link pendingPathRel}), and
 * the absolute path when a relocated dock puts it where git cannot. Every
 * report this module makes about the file — the rewrite's result, the refusal
 * it throws, and each degrade {@link readPendingTolerant} announces — takes
 * its spelling from here, so no report composes a second one out of
 * `pendingPath` with `node:path` and none spells the file by the basename
 * this chain's declaration was free not to use
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*).
 */
function reportedPendingPath(ctx: PendingLedgerContext): string {
  return pendingPathRel(ctx) ?? ctx.pendingPath;
}

/**
 * Whether `phase` is the queue's own writer — its declared
 * {@link Phase.writablePaths} admit the ledger's path, read through the same
 * `matchesAny` the write guard enforces the fence with, so the carve-out and
 * the enforcement cannot disagree about what a glob covers.
 *
 * Keyed on the **declared** fence and nothing else
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*): the chain said
 * which paths this phase may write, so the engine reads that statement rather
 * than guessing from a phase's name, its prompt, or what its last commit
 * touched. A relocated ledger ({@link pendingPathRel}) is no phase's writer
 * here — `writablePaths` is repo-relative by declaration, so no glob a chain
 * can write names a path outside the repo.
 */
function writesPendingLedger(
  ctx: PendingLedgerContext,
  phase: Pick<Phase, "writablePaths">,
): boolean {
  const rel = pendingPathRel(ctx);
  return rel !== undefined && matchesAny(rel, phase.writablePaths);
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
 * spec/pending.md "Dispatch reads come from the tip, not the tree":
 * resolves the committed `HEAD` tip (`git.readFileAtRef`), never the
 * working tree — a mid-wave merge, an engine revert, or an operator's
 * staged edit can each leave the tree ahead of or behind the branch, and a
 * dispatch decision must never act on state no commit owns. An out-of-tree
 * `pendingPath` (a relocated state root) has no tip to read — invisible to
 * git by construction ({@link commitPendingUpdate}), so it stays the one
 * disk-reading case here, alongside {@link readPendingTolerant}.
 */
async function readPending(
  ctx: PendingLedgerContext,
): Promise<PendingEntry[]> {
  if (isPendingRelocated(ctx)) {
    // win32 MAX_PATH: a relocated pendingPath sits under an arbitrary
    // state root. namespacedJoin (src/paths.ts) is the shared idiom.
    // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts)
    // throws on any other stat failure rather than reporting absence, so a
    // ledger that is present but unreachable — a symlink loop, a
    // permission-denied parent on the state root — refuses here instead of
    // dispatching this tick over an empty queue.
    if (!existsLoud(namespacedJoin(ctx.pendingPath))) return [];
    const raw = await readFile(namespacedJoin(ctx.pendingPath), "utf8");
    const r = parsePending(raw, ctx.entryExtension);
    if (!r.ok) throw new PendingParseFailure(r.errors);
    return r.entries;
  }
  // Non-relocated by the branch above, so the fold always answers.
  const rel = pendingPathRel(ctx)!;
  const raw = await git.readFileAtRef(ctx.repoRoot, "HEAD", rel);
  if (raw === null) return [];
  const r = parsePending(raw, ctx.entryExtension);
  if (!r.ok) throw new PendingParseFailure(r.errors);
  return r.entries;
}

/**
 * Tolerant twin of {@link readPending}, kept only for
 * `TickResult.pendingAfter` — an informational re-read taken after this
 * tick's own strict decide- or rewrite-read already ran (and, for the fanout
 * wave, after any shipped work already landed on trunk). A parse failure
 * here means something outside this tick corrupted the file in the gap
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
 * the probe: `existsLoud` (src/fsProbe.ts) still splits absent from
 * unreachable, and the catches below turn that refusal — and any failure
 * of the read past it — into the warn a silent `existsSync` `false` would
 * have skipped.
 */
export async function readPendingTolerant(
  ctx: PendingLedgerContext,
): Promise<PendingEntry[]> {
  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  try {
    if (!existsLoud(namespacedJoin(ctx.pendingPath))) return [];
  } catch (err) {
    // Present but unreachable — a symlink loop, a permission-denied
    // parent. `readPending`'s strict twin refuses on exactly this; here it
    // is announced and treated as empty, so a drained-looking
    // `pendingAfter` is never the first anyone hears of it. Named through
    // `reportedPendingPath`, like the two announcements below it: a chain
    // that docks its ledger elsewhere is told about the file it declared.
    ctx.log.warn(
      `[flume] ${reportedPendingPath(ctx)} could not be stat'd (${
        (err as Error).message
      }); treating as empty`,
    );
    return [];
  }
  let raw: string;
  try {
    raw = await readFile(namespacedJoin(ctx.pendingPath), "utf8");
  } catch (err) {
    // Stattable but unreadable — a directory at the path, a mode denying
    // the file itself, a delete racing the probe above. Same declared
    // degrade as the stat and parse branches: announced, then `[]`, never
    // a throw that would take this tick's `TickResult` with it.
    ctx.log.warn(
      `[flume] ${reportedPendingPath(ctx)} could not be read (${
        (err as Error).message
      }); treating as empty`,
    );
    return [];
  }
  const r = parsePending(raw, ctx.entryExtension);
  if (!r.ok) {
    ctx.log.warn(
      `[flume] ${reportedPendingPath(ctx)} failed to parse ` +
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
 * file whose location the chain chose, and the caller holds it only as the
 * absolute `pendingPath` it would have to re-fold itself.
 */
export interface PendingRewriteResult {
  /** The tip after the call: the new ship commit, or the tip that never moved. */
  readonly sha: string;
  /**
   * A live foreign tip claim refused the rewrite. Checked before the write,
   * so nothing on disk moved either: the queue at {@link path} is the one the
   * call read.
   */
  readonly tipMoved: boolean;
  /** The ledger's path as a report spells it ({@link reportedPendingPath}). */
  readonly path: string;
}

/**
 * The wave's ledger rewrite: retire what shipped, drain the `blockedBy`
 * gates those tags were holding, record the footprints a failed merge
 * observed, and commit the result.
 *
 * spec/loop.md "Tip verify", "Harness-driven commits carry no expected-tip
 * bookkeeping": no sha comparison — `liveForeignClaimPid`, checked fresh
 * immediately before this function's own harness-driven `commitPaths` call,
 * the wave's other tip-verify site beside `cherryPickRange` (`runFanout`,
 * `src/waveTick.ts`). Checked before `writeFile`: a refusal here leaves
 * pending.json untouched on disk rather than a write with no commit behind
 * it. No live claim means the rewrite recommits on whatever tip is current —
 * its content derives from the wave's own outcomes, never from a recorded
 * tip.
 *
 * That ordering is what splits the two refusals' reports. The claim refuses
 * before the write, so {@link PendingRewriteResult} says the file is the one
 * this call read; the commit refuses after it, so the throw names the path the
 * rewrite is standing at, uncommitted. Neither leaves the caller to work out
 * which happened from the file's own mtime.
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
  // Re-read pending.json fresh, right before deriving the rewrite —
  // NOT the tick-start snapshot the caller read before provisioning
  // worktrees and running agents. A fanout wave's fanned-out agent runs
  // and serial cherry-picks can take long enough for another process
  // (a concurrent tick, a hand fix) to land its own commit to
  // pending.json on trunk in the meantime; deriving from the stale
  // snapshot would blindly overwrite that concurrent write with
  // whatever this wave saw at tick start — silently resurrecting
  // retired fields or reverting fixes in entries this wave never
  // touched. Sourcing the rewrite from the current on-disk state at
  // write time means this wave only ever removes the tags it shipped
  // and touches observedFiles/blockedBy for tags it knows about.
  const current = await readPending(ctx);
  // A blockedBy gate naming a tag this wave shipped is resolved HERE,
  // mechanically: this wave just merged and gated that tag, so
  // "did the blocker land" needs no plan tick — the next wave forms
  // without a plan interim. Judgment gates (parked) stay plan's. A
  // multi-parent blockedBy drains one landed tag at a time: the gate
  // only flips to open once every named parent has shipped.
  const after = current
    .filter((e) => !shipped.has(e.tag))
    .map((e) => {
      if (e.gate.kind !== "blockedBy") return e;
      const remainingTags = e.gate.tags.filter((tag) => !shipped.has(tag));
      if (remainingTags.length === e.gate.tags.length) return e;
      return remainingTags.length === 0
        ? { ...e, gate: { kind: "open" as const } }
        : { ...e, gate: { kind: "blockedBy" as const, tags: remainingTags } };
    })
    .map((e) => {
      const obs = observed.get(e.tag);
      if (!obs || obs.length === 0) return e;
      const merged = [...new Set([...(e.observedFiles ?? []), ...obs])];
      return { ...e, observedFiles: merged };
    });
  const serialized = JSON.stringify(after, null, 2) + "\n";
  // A footprint-only update can be a no-op (same collision, same paths,
  // second time around) — committing an unchanged file fails, so skip.
  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  const existing = await readFile(
    namespacedJoin(ctx.pendingPath),
    "utf8",
  ).catch(() => "");
  if (serialized === existing) {
    return {
      sha: await git.revParse(ctx.repoRoot),
      tipMoved: false,
      path: reportedPendingPath(ctx),
    };
  }
  // A relocated flumeDir puts pendingPath outside the repo, where staging
  // it would fatal — after the entries already merged. An out-of-tree dock
  // is invisible to git by construction, so no chore commit is wanted: the
  // disk write alone carries the auto-unblock and observedFiles forward —
  // computed before the tip check below, which only guards the git-commit
  // path this dock never takes.
  const relocated = isPendingRelocated(ctx);

  if (!relocated) {
    // spec/loop.md "Tip verify", re-checked fresh immediately before this
    // function's own commit — the wave's other harness-driven commit besides
    // `cherryPickRange`. Checked before `writeFile`: a refusal here leaves
    // pending.json untouched on disk, never a write with no commit behind
    // it. Shipped entries this wave already cherry-picked stay shipped
    // regardless — only the ledger update itself is refused.
    const foreignClaim = await liveForeignClaimPid(
      ctx.repoRoot,
      ctx.ownTipClaimPid,
    );
    if (foreignClaim !== null) {
      return {
        sha: await git.revParse(ctx.repoRoot),
        tipMoved: true,
        path: reportedPendingPath(ctx),
      };
    }
  }

  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(dirname(ctx.pendingPath)), {
    recursive: true,
  });
  await writeFile(namespacedJoin(ctx.pendingPath), serialized, "utf8");
  if (relocated) {
    return {
      sha: await git.revParse(ctx.repoRoot),
      tipMoved: false,
      path: reportedPendingPath(ctx),
    };
  }
  // Scoped to pending.json — `git add -A` would sweep up untracked worktree
  // metadata and unrelated user changes into the harness's chore commit.
  const footprintTags = [...observed.keys()];
  const message =
    ctx.commitMessage?.(shippedTags, footprintTags) ??
    (shippedTags.length > 0
      ? `chore(flume): ship ${shippedTags.join(", ")}`
      : `chore(flume): record merge-failure footprints for ${footprintTags.join(", ")}`);
  // The one refusal on this call that is reached **after** the write, so the
  // only one whose report has a disk state to state: the rewrite is sitting in
  // the tree with no commit owning it. Every cause git refuses this partial
  // commit for — a paused merge or cherry-pick in the primary checkout, a lost
  // `index.lock`, a disk error — leaves that same file there, so the fact is
  // stated off the ordering in hand rather than keyed on which cause it was
  // (`.claude/rules/engine-boundary.md`, *Told, not inferred*). Without it the
  // refusal reaches an operator as git's sentence alone, and the modified
  // queue in `git status` beside it is theirs to attribute
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*). The cause rides `cause` and is quoted in the
  // message, so nothing downstream reconstructs it.
  let sha: string;
  try {
    sha = await git.commitPaths({
      cwd: ctx.repoRoot,
      message,
      paths: [ctx.pendingPath],
    });
  } catch (err) {
    throw new Error(
      `the rewritten queue stands on disk at ${reportedPendingPath(ctx)}, ` +
        `uncommitted — the pending-ledger commit refused: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return { sha, tipMoved: false, path: reportedPendingPath(ctx) };
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
    const rel = pendingPathRel(ctx);
    if (rel === undefined || !matchesAny(rel, phase.writablePaths)) {
      throw new PendingParseFailure(
        err.errors,
        rel === undefined
          ? `the ledger is relocated outside the repo root, which no ` +
            `repo-relative fence can name, so '${phase.name}' cannot rewrite it`
          : `'${phase.name}' does not declare ${rel} writable, so this tick ` +
            `cannot rewrite it`,
      );
    }
    ctx.log.warn(
      `[flume] ${phase.name} declares ${rel} writable; running it over the ` +
        `unparseable queue with the failure as a tick fact (${err.errors.length} error(s))`,
    );
    return {
      pending: [],
      queueParseFailure: { path: rel, errors: err.errors },
    };
  }
  return { pending, queueParseFailure: undefined };
}

/**
 * Chain-less informational read of a pending.json at `pendingPath`: absent
 * (`ENOENT`) reads as the empty, valid list (nothing planned is nothing
 * pending); present reads through `parsePendingLoose` (core fields
 * validated, no extension composed — never a write path). Any other read
 * failure (permission denied, a path too long for the platform, …) is
 * rethrown rather than folded into the absent case
 * (`.claude/rules/engineering.md`, "Loud or nothing") — rethrowing leaves the
 * caller to decide how to surface it: `flume status` (`src/cli.ts`) catches
 * it, reports the failure, and exits non-zero rather than printing
 * "pending: 0" over a queue it could not read.
 *
 * The one read on this page that takes a bare path rather than a
 * {@link PendingLedgerContext}: it runs where no chain resolved, which is the
 * whole reason it exists beside the reads that compose a declared extension.
 */
export function readPendingLoose(pendingPath: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(namespacedJoin(pendingPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, entries: [], errors: [] };
    }
    throw err;
  }
  return parsePendingLoose(raw);
}
