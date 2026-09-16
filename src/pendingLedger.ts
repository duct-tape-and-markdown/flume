/**
 * The pending ledger's I/O: every way a tick reads the queue file, the
 * relocation check those reads turn on, and the one rewrite that retires
 * what a wave shipped.
 *
 * Four calls that share one fact each — where the ledger lives, which
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
 * tolerant one announces and degrades, and the rewrite reports the sha and
 * the tip verdict it got — what a tick does about any of it stays with the
 * dispatcher (`src/Dispatcher.ts`) and the wave (`src/waveTick.ts`).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

import { existsLoud } from "./fsProbe.js";
import * as git from "./git.js";
import type { Logger } from "./log.js";
import { escapesRoot, matchesAny, namespacedJoin } from "./paths.js";
import { parsePending, PendingParseFailure } from "./PendingSchema.js";
import type { EntryExtension, PendingEntry } from "./PendingSchema.js";
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
export async function readPending(
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
  const rel = relative(ctx.repoRoot, ctx.pendingPath);
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
    // `pendingAfter` is never the first anyone hears of it.
    ctx.log.warn(
      `[flume] pending.json could not be stat'd (${
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
      `[flume] pending.json could not be read (${
        (err as Error).message
      }); treating as empty`,
    );
    return [];
  }
  const r = parsePending(raw, ctx.entryExtension);
  if (!r.ok) {
    ctx.log.warn(
      `[flume] pending.json failed to parse (${r.errors.length} errors); treating as empty`,
    );
    return [];
  }
  return r.entries;
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
 */
export async function commitPendingUpdate(
  ctx: PendingLedgerContext,
  shippedTags: string[],
  mergeOutcomes: readonly TickVerdictMergeOutcome[],
  partitionIgnore: string[],
): Promise<{ sha: string; tipMoved: boolean }> {
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
    return { sha: await git.revParse(ctx.repoRoot), tipMoved: false };
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
      };
    }
  }

  // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(dirname(ctx.pendingPath)), {
    recursive: true,
  });
  await writeFile(namespacedJoin(ctx.pendingPath), serialized, "utf8");
  if (relocated) {
    return { sha: await git.revParse(ctx.repoRoot), tipMoved: false };
  }
  // Scoped to pending.json — `git add -A` would sweep up untracked worktree
  // metadata and unrelated user changes into the harness's chore commit.
  const footprintTags = [...observed.keys()];
  const message =
    ctx.commitMessage?.(shippedTags, footprintTags) ??
    (shippedTags.length > 0
      ? `chore(flume): ship ${shippedTags.join(", ")}`
      : `chore(flume): record merge-failure footprints for ${footprintTags.join(", ")}`);
  const sha = await git.commitPaths({
    cwd: ctx.repoRoot,
    message,
    paths: [ctx.pendingPath],
  });
  return { sha, tipMoved: false };
}
