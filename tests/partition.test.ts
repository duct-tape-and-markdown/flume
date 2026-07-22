import { describe, expect, it } from "vitest";

import { partitionByFileOverlap } from "../src/partition.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";

function makeEntry(
  tag: string,
  paths: { new?: string[]; edit?: string[]; retire?: string[] } = {},
): PendingEntry {
  return {
    tag,
    summary: `entry ${tag}`,
    per: { path: "spec/RELEASE-v0.1.md", section: "5. Tests" },
    gate: { kind: "open" },
    dependsOnForks: [],
    files: {
      new: (paths.new ?? []).map((p) => ({ path: p, description: "n" })),
      edit: (paths.edit ?? []).map((p) => ({ path: p, description: "e" })),
      retire: paths.retire ?? [],
    },
    schemaDelta: "none",
    tests: [],
    acceptance: "green",
  };
}

const tags = (batch: PendingEntry[]): string[] => batch.map((e) => e.tag);

describe("partitionByFileOverlap — disjoint entries", () => {
  it("packs disjoint entries into a single batch", () => {
    const entries = [
      makeEntry("A", { edit: ["src/a.ts"] }),
      makeEntry("B", { edit: ["src/b.ts"] }),
      makeEntry("C", { edit: ["src/c.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4 });

    expect(batches).toHaveLength(1);
    expect(tags(batches[0]!)).toEqual(["A", "B", "C"]);
  });

  it("treats new/edit/retire as a unified touched-path set", () => {
    const entries = [
      makeEntry("A", { new: ["src/x.ts"] }),
      makeEntry("B", { retire: ["src/x.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4 });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A"]);
    expect(tags(batches[1]!)).toEqual(["B"]);
  });

  it("returns an empty array for no entries", () => {
    expect(partitionByFileOverlap([], { maxParallel: 4 })).toEqual([]);
  });
});

describe("partitionByFileOverlap — overlap splits stably", () => {
  it("splits two entries that touch the same path into separate batches", () => {
    const entries = [
      makeEntry("A", { edit: ["src/shared.ts"] }),
      makeEntry("B", { edit: ["src/shared.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4 });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A"]);
    expect(tags(batches[1]!)).toEqual(["B"]);
  });

  it("preserves pending order when overlap forces a split", () => {
    const entries = [
      makeEntry("A", { edit: ["src/shared.ts", "src/a.ts"] }),
      makeEntry("B", { edit: ["src/b.ts"] }),
      makeEntry("C", { edit: ["src/shared.ts", "src/c.ts"] }),
      makeEntry("D", { edit: ["src/d.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4 });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A", "B", "D"]);
    expect(tags(batches[1]!)).toEqual(["C"]);
  });

  it("is stable across repeated invocations with the same input", () => {
    const entries = [
      makeEntry("A", { edit: ["src/shared.ts"] }),
      makeEntry("B", { edit: ["src/b.ts"] }),
      makeEntry("C", { edit: ["src/shared.ts"] }),
      makeEntry("D", { edit: ["src/b.ts"] }),
    ];

    const first = partitionByFileOverlap(entries, { maxParallel: 4 });
    const second = partitionByFileOverlap(entries, { maxParallel: 4 });

    expect(first.map(tags)).toEqual(second.map(tags));
    expect(first.map(tags)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });
});

describe("partitionByFileOverlap — maxParallel respected", () => {
  it("opens a new batch once maxParallel is reached, even for disjoint paths", () => {
    const entries = [
      makeEntry("A", { edit: ["src/a.ts"] }),
      makeEntry("B", { edit: ["src/b.ts"] }),
      makeEntry("C", { edit: ["src/c.ts"] }),
      makeEntry("D", { edit: ["src/d.ts"] }),
      makeEntry("E", { edit: ["src/e.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 2 });

    expect(batches.every((b) => b.length <= 2)).toBe(true);
    expect(batches.map(tags)).toEqual([["A", "B"], ["C", "D"], ["E"]]);
  });

  it("maxParallel=1 yields one entry per batch in pending order", () => {
    const entries = [
      makeEntry("A", { edit: ["src/a.ts"] }),
      makeEntry("B", { edit: ["src/b.ts"] }),
      makeEntry("C", { edit: ["src/c.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 1 });

    expect(batches.map(tags)).toEqual([["A"], ["B"], ["C"]]);
  });

  it("backfills later disjoint entries into an earlier non-full batch", () => {
    const entries = [
      makeEntry("A", { edit: ["src/a.ts"] }),
      makeEntry("B", { edit: ["src/a.ts"] }),
      makeEntry("C", { edit: ["src/c.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 3 });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A", "C"]);
    expect(tags(batches[1]!)).toEqual(["B"]);
  });
});

describe("partitionByFileOverlap — observed footprints", () => {
  it("separates entries whose observed footprints overlap even when declared files are disjoint", () => {
    // A collided with B's ground on a prior merge attempt: its declared
    // files are disjoint from B's, but its recorded footprint is not.
    const entries = [
      { ...makeEntry("A", { edit: ["src/a.ts"] }), observedFiles: ["src/a.ts", "src/b.ts"] },
      makeEntry("B", { edit: ["src/b.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4 });

    expect(batches.map(tags)).toEqual([["A"], ["B"]]);
  });
});
