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
    per: {
      path: "spec/pending.md",
      section: "Fanout partition — disjoint touched paths",
    },
    gate: { kind: "open" },
    dependsOnForks: [],
    kind: "work",
    files: {
      new: (paths.new ?? []).map((p) => ({ path: p, description: "n" })),
      edit: (paths.edit ?? []).map((p) => ({ path: p, description: "e" })),
      retire: paths.retire ?? [],
    },
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

    const batches = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

    expect(batches).toHaveLength(1);
    expect(tags(batches[0]!)).toEqual(["A", "B", "C"]);
  });

  it("treats new/edit/retire as a unified touched-path set", () => {
    const entries = [
      makeEntry("A", { new: ["src/x.ts"] }),
      makeEntry("B", { retire: ["src/x.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A"]);
    expect(tags(batches[1]!)).toEqual(["B"]);
  });

  it("returns an empty array for no entries", () => {
    expect(partitionByFileOverlap([], { maxParallel: 4, listing: [] })).toEqual([]);
  });
});

describe("partitionByFileOverlap — overlap splits stably", () => {
  it("splits two entries that touch the same path into separate batches", () => {
    const entries = [
      makeEntry("A", { edit: ["src/shared.ts"] }),
      makeEntry("B", { edit: ["src/shared.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

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

    const batches = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

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

    const first = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });
    const second = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

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

    const batches = partitionByFileOverlap(entries, { maxParallel: 2, listing: entries });

    expect(batches.every((b) => b.length <= 2)).toBe(true);
    expect(batches.map(tags)).toEqual([["A", "B"], ["C", "D"], ["E"]]);
  });

  it("maxParallel=1 yields one entry per batch in pending order", () => {
    const entries = [
      makeEntry("A", { edit: ["src/a.ts"] }),
      makeEntry("B", { edit: ["src/b.ts"] }),
      makeEntry("C", { edit: ["src/c.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 1, listing: entries });

    expect(batches.map(tags)).toEqual([["A"], ["B"], ["C"]]);
  });

  it("backfills later disjoint entries into an earlier non-full batch", () => {
    const entries = [
      makeEntry("A", { edit: ["src/a.ts"] }),
      makeEntry("B", { edit: ["src/a.ts"] }),
      makeEntry("C", { edit: ["src/c.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 3, listing: entries });

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

    const batches = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

    expect(batches.map(tags)).toEqual([["A"], ["B"]]);
  });
});

describe("partitionByFileOverlap — ignore (Chain.supervisorPolicy.partitionIgnore)", () => {
  it("packs two entries into the same wave when they collide only on an ignored path", () => {
    const entries = [
      makeEntry("A", { edit: ["shared-lock.json", "src/a.ts"] }),
      makeEntry("B", { edit: ["shared-lock.json", "src/b.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, {
      maxParallel: 4,
      listing: entries,
      ignore: ["shared-lock.json"],
    });

    expect(batches).toHaveLength(1);
    expect(tags(batches[0]!)).toEqual(["A", "B"]);
  });

  it("still splits two entries that collide on a non-ignored path in addition to an ignored one", () => {
    const entries = [
      makeEntry("A", { edit: ["shared-lock.json", "src/shared.ts"] }),
      makeEntry("B", { edit: ["shared-lock.json", "src/shared.ts"] }),
    ];

    const batches = partitionByFileOverlap(entries, {
      maxParallel: 4,
      listing: entries,
      ignore: ["shared-lock.json"],
    });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A"]);
    expect(tags(batches[1]!)).toEqual(["B"]);
  });

  it("default (no ignore) still collides on the shared path", () => {
    const entries = [
      makeEntry("A", { edit: ["shared-lock.json"] }),
      makeEntry("B", { edit: ["shared-lock.json"] }),
    ];

    const batches = partitionByFileOverlap(entries, { maxParallel: 4, listing: entries });

    expect(batches).toHaveLength(2);
    expect(tags(batches[0]!)).toEqual(["A"]);
    expect(tags(batches[1]!)).toEqual(["B"]);
  });
});

// ---------- a work entry's footprint is its steps' too ----------
//
// `spec/pending.md`, "The queue is a forest": a `work` entry's footprint is
// its own `files` and its steps' together, for the partition and the fence
// alike. A step is no dispatch unit, so it is never a candidate of its own —
// the only way its files reach the collision set is through the entry above
// it, which is why the partition is handed the whole listing beside the
// candidates.

/** A step of `parent`, declaring `edit` paths of its own. */
function makeStep(tag: string, parent: string, edit: string[]): PendingEntry {
  return { ...makeEntry(tag, { edit }), kind: "step", parent };
}

describe("partitionByFileOverlap — a work entry's footprint is its steps' too", () => {
  it("two work entries colliding only through a step are not placed in one batch", () => {
    const a = makeEntry("A", { edit: ["src/a.ts"] });
    const b = makeEntry("B", { edit: ["src/b.ts"] });
    const listing = [
      a,
      makeStep("A.1", "A", ["src/shared.ts"]),
      b,
      makeStep("B.1", "B", ["src/shared.ts"]),
    ];

    // The premise: the two work entries' *own* declarations are disjoint, so
    // a listing holding no steps packs them into one batch. Without this the
    // split below would read green over entries that simply overlapped.
    expect(
      partitionByFileOverlap([a, b], { maxParallel: 4, listing: [a, b] }),
    ).toHaveLength(1);

    const batches = partitionByFileOverlap([a, b], {
      maxParallel: 4,
      listing,
    });

    expect(batches.map(tags)).toEqual([["A"], ["B"]]);
  });

  it("a step's own path counts as the work entry's for the ignore filter too", () => {
    const a = makeEntry("A", { edit: ["src/a.ts"] });
    const b = makeEntry("B", { edit: ["src/b.ts"] });
    const listing = [
      a,
      makeStep("A.1", "A", ["shared-lock.json"]),
      b,
      makeStep("B.1", "B", ["shared-lock.json"]),
    ];

    expect(
      partitionByFileOverlap([a, b], { maxParallel: 4, listing }),
    ).toHaveLength(2);
    expect(
      partitionByFileOverlap([a, b], {
        maxParallel: 4,
        listing,
        ignore: ["shared-lock.json"],
      }),
    ).toHaveLength(1);
  });
});
