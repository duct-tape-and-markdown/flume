/**
 * partition — disjoint-set partitioning of pending entries for fanout.
 *
 * Two entries can run in parallel iff their `touchedPaths()` sets are
 * disjoint. This module owns that one read and the two questions asked of it:
 * the batches a queue partitions into, and whether one candidate is disjoint
 * from a set of entries the caller holds ({@link isDisjointFrom}) — which is
 * the question a fanout wave's freed slot asks of the entries still in flight.
 *
 * Greedy partitioner: walk pending in order, place each entry in the first
 * batch where its paths don't overlap any existing batch entry. This isn't
 * optimal-by-count but it's stable and respects pending order (priority).
 */

import { matchesAny } from "./paths.js";
import { touchedPaths } from "./PendingSchema.js";
import type { PendingEntry } from "./PendingSchema.js";

export interface PartitionOptions {
  /** Maximum parallel ticks the harness will spawn. */
  maxParallel: number;
  /**
   * Globs (matched by `matchesAny`) whose paths never count toward the
   * partition's collision set — `Chain.supervisorPolicy.partitionIgnore`
   * (spec/pending.md, "Fanout partition — disjoint touched paths"). A path
   * an entry touches that matches one of these is dropped before placement;
   * the entry's own `declaredPaths`/`observedFiles` are untouched. Default
   * `[]`, byte-identical to no filter.
   */
  ignore?: string[];
}

/**
 * The paths an entry collides on: its touched paths less whatever `ignore`
 * drops. The one read every placement below is made against, so a caller
 * asking the disjointness question of a set it holds itself
 * ({@link isDisjointFrom}) cannot spell the collision set differently.
 */
function collisionPaths(entry: PendingEntry, ignore: string[]): Set<string> {
  return new Set(touchedPaths(entry).filter((p) => !matchesAny(p, ignore)));
}

/**
 * Whether `entry` shares no collision path with any of `others` — the same
 * placement test {@link partitionByFileOverlap} makes, asked of one candidate
 * against a set the caller holds rather than against a batch this module
 * built.
 *
 * The batch is not the only shape of the question: a fanout wave's freed slot
 * asks it again mid-wave, of the next queued candidate against the entries
 * still in flight (`nextDisjointPick`, `src/selection.ts`), and that set is
 * neither a batch nor knowable when the wave opened.
 */
export function isDisjointFrom(
  entry: PendingEntry,
  others: readonly PendingEntry[],
  opts: { ignore?: string[] },
): boolean {
  const ignore = opts.ignore ?? [];
  const paths = collisionPaths(entry, ignore);
  for (const other of others) {
    if (intersects(collisionPaths(other, ignore), paths)) return false;
  }
  return true;
}

/**
 * Returns an ordered list of batches. Each batch's entries have disjoint
 * touched-path sets and can run in parallel worktrees. The first batch is the
 * initial fill of a fanout wave, whose freed slots then pull past it
 * ({@link isDisjointFrom}); the batches beyond it are what that fill would
 * have been had the wave stopped there, and are the shape `render` previews.
 */
export function partitionByFileOverlap(
  entries: readonly PendingEntry[],
  opts: PartitionOptions,
): PendingEntry[][] {
  const ignore = opts.ignore ?? [];
  const batches: { entries: PendingEntry[]; paths: Set<string> }[] = [];

  for (const entry of entries) {
    const paths = collisionPaths(entry, ignore);

    let placed = false;
    for (const batch of batches) {
      if (batch.entries.length >= opts.maxParallel) continue;
      if (!intersects(batch.paths, paths)) {
        batch.entries.push(entry);
        for (const p of paths) batch.paths.add(p);
        placed = true;
        break;
      }
    }

    if (!placed) {
      batches.push({ entries: [entry], paths: paths });
    }
  }

  return batches.map((b) => b.entries);
}

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  // Iterate the smaller set for the membership probe.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) return true;
  return false;
}
