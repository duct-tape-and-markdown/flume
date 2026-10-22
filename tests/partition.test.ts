import { describe, expect, it } from "vitest";

import { WAVE_WIDTH_FLOOR_REASON } from "../src/counted.ts";
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

// ---------- the width below one ----------
//
// `.claude/rules/engineering.md`, *Loud or nothing*: the fill's cap check
// compares a batch's length against the declared width, so a width below one
// caps nothing and the helper answers with a full serialization of the queue
// it was asked to partition — a confident wrong answer where the siblings
// carrying the same width (the chain's `supervisorPolicy.maxParallel` at the
// load, the embedder's `DispatcherOptions.maxParallel` at construction)
// already refuse. An *absent* width is that comparison inverted and the
// opposite wrong answer: no batch length is ever at `undefined`, so every
// disjoint entry joins the first batch and the wave runs as wide as the queue.

/** Four entries with pairwise-disjoint footprints — one wave's worth. */
const fourDisjoint = (): PendingEntry[] => [
  makeEntry("A", { edit: ["src/a.ts"] }),
  makeEntry("B", { edit: ["src/b.ts"] }),
  makeEntry("C", { edit: ["src/c.ts"] }),
  makeEntry("D", { edit: ["src/d.ts"] }),
];

/**
 * The message `partitionByFileOverlap` refuses `width` with, read off the real
 * call. Throws when the call answered instead, so a tree where the width is
 * unguarded reds on the arm rather than on a comparison against undefined.
 */
function refusal(
  width: number | undefined,
  listing: readonly PendingEntry[],
): string {
  try {
    // `undefined` is a width the signature refuses and a consumer still
    // reaches: `.flume/chain.ts` is transpiled by `tsx` and never typechecked,
    // so an `order` hook composing this call ships the absent width with no
    // compiler between it and the fill. The cast is that call, not a shape
    // invented here.
    partitionByFileOverlap(listing, { maxParallel: width as number, listing });
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(
    `partitionByFileOverlap answered a maxParallel of ${width} instead of ` +
      `refusing it`,
  );
}

describe("partitionByFileOverlap — a wave width below one is refused", () => {
  it("the partition helper fills a batch to the declared width", () => {
    const listing = fourDisjoint();

    const batches = partitionByFileOverlap(listing, {
      maxParallel: 4,
      listing,
    });

    // The property the refusal protects, stated in the direction that breaks:
    // one batch holding all four, not four batches of one. Asserting only
    // `length <= 4` would read green over the serialization a zero produces.
    expect(batches.map(tags)).toEqual([["A", "B", "C", "D"]]);
  });

  it("the partition helper refuses a wave width below one", () => {
    const listing = fourDisjoint();

    // The fixture's own control: this same queue at a width in range answers,
    // so each refusal below is the width answering rather than a call refused
    // for an unrelated reason.
    expect(() =>
      partitionByFileOverlap(listing, { maxParallel: 2, listing }),
    ).not.toThrow();

    // Zero caps nothing, and the sentence is the siblings' own — one width,
    // one reason, whichever surface the caller reached it through. Compared
    // whole, because a required argument has no omission to offer and a
    // refusal inviting the caller to drop it would be advice the signature
    // refuses.
    expect(refusal(0, listing)).toBe(
      `partition called with maxParallel: 0; it must be a positive integer ` +
        `— ${WAVE_WIDTH_FLOOR_REASON}.`,
    );
    // A negative is the same wave one spelling further out.
    expect(refusal(-1, listing)).toMatch(
      /maxParallel: -1[\s\S]*must be a positive integer/,
    );
  });

  it("the partition helper refuses a fractional wave width", () => {
    const listing = fourDisjoint();

    expect(() =>
      partitionByFileOverlap(listing, { maxParallel: 2, listing }),
    ).not.toThrow();

    // A fraction is the same defect one rung quieter: 1.5 fills a batch to one
    // and the width the caller asked for is simply gone.
    expect(refusal(1.5, listing)).toMatch(
      /maxParallel: 1\.5[\s\S]*must be a positive integer/,
    );
  });

  it("a partition width of undefined is refused rather than filling one unbounded batch", () => {
    const listing = fourDisjoint();

    // The fixture's own control, and the cap read in the direction that
    // breaks: two of these four per batch, so a width the fill never compares
    // against would show up here as one batch of all four.
    const capped = partitionByFileOverlap(listing, { maxParallel: 2, listing });
    expect(capped.map(tags)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);

    // Compared whole, and the sentence is the siblings' own: one width, one
    // reason, whichever surface the caller reached it through. No omission
    // clause, because a required argument has no default below it to fall
    // through to — the two surfaces that do keep theirs
    // (`tests/chain.test.ts`, `tests/Dispatcher.test.ts`).
    expect(refusal(undefined, listing)).toBe(
      `partition called with maxParallel: undefined; it must be a positive ` +
        `integer — ${WAVE_WIDTH_FLOOR_REASON}.`,
    );
  });
});
