/**
 * partition — disjoint-set partitioning of pending entries for fanout.
 *
 * Two entries can run in parallel iff their `touchedPaths()` sets are
 * disjoint. This module groups pickable entries into maximal disjoint
 * batches; the dispatcher picks the first batch and fans out.
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
 * Returns an ordered list of batches. Each batch's entries have disjoint
 * touched-path sets and can run in parallel worktrees. Batches are processed
 * sequentially: the dispatcher runs batch[0], then re-derives pending and
 * partitions again.
 */
export function partitionByFileOverlap(
  entries: readonly PendingEntry[],
  opts: PartitionOptions,
): PendingEntry[][] {
  const ignore = opts.ignore ?? [];
  const batches: { entries: PendingEntry[]; paths: Set<string> }[] = [];

  for (const entry of entries) {
    const paths = new Set(
      touchedPaths(entry).filter((p) => !matchesAny(p, ignore)),
    );

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
