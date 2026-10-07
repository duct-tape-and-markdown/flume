/**
 * The order the harness package serves the queue in (`harness/order.ts`;
 * `spec/harness.md`, *The phases*): each key of it, and the permutation the
 * engine refuses a hook without.
 *
 * Every case drives the real hook over a context composed off a real queue —
 * the `blockedBy` edges are derived from the entries the fixture queue holds,
 * by the rule the engine composes them by, so a case cannot hand the order an
 * edge set no queue could produce. Each key is driven with the keys *beneath*
 * it set against it: the goal case files the second goal's work older, the
 * chain case files the longest chain's entry newest. A case that let the lower
 * keys agree would pass over an order that read only one of them.
 *
 * What the engine does with the returned sequence, and the refusal it raises
 * over a hook that drops or adds an entry, is `tests/Dispatcher.test.ts`'s
 * subject; the wiring of this hook onto the package's chain is
 * `tests/harnessChain.test.ts`'s. What is judged here is the policy.
 */

import { expect, it } from "vitest";

import { queueOrder } from "../harness/order.ts";
import { GOAL_RANK_FIELD } from "../harness/entryExtension.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { OrderContext } from "../src/Phase.ts";

/** How a fixture entry differs from the shared shape. */
interface EntryOver {
  readonly kind?: PendingEntry["kind"];
  readonly parent?: string;
  readonly rank?: number;
  readonly blockedBy?: readonly string[];
  /** Provenance-shaped fields, carried so a case can prove they order nothing. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * One queued entry, typed as the engine's own {@link PendingEntry} rather
 * than a bag cast into one — a core-field change is a tsc error here and at
 * every case built from it.
 */
const entry = (tag: string, over: EntryOver = {}): PendingEntry => ({
  tag,
  gate:
    over.blockedBy === undefined
      ? { kind: "open" }
      : { kind: "blockedBy", tags: [...over.blockedBy] },
  dependsOnForks: [],
  kind: over.kind ?? "work",
  ...(over.parent === undefined ? {} : { parent: over.parent }),
  ...(over.rank === undefined ? {} : { [GOAL_RANK_FIELD]: over.rank }),
  files: {
    new: [],
    edit: [{ path: "src/widget.ts", description: "the work" }],
    retire: [],
  },
  summary: "one line of what",
  per: { path: "spec/harness.md", section: "The phases" },
  acceptance: "what turns green",
  tests: [],
  pins: [],
  ...(over.extra ?? {}),
});

/**
 * The context the engine hands the hook, composed off `queue` the way the
 * engine composes it: an edge survives only while the queue still holds the
 * blocker it names, because an entry leaving the queue *is* the settled
 * verdict (`blockedByGraph`, `src/selection.ts`).
 */
function contextFor(
  queue: readonly PendingEntry[],
  filedAt: ReadonlyMap<string, number> = new Map(),
): OrderContext {
  const stillQueued = new Set(queue.map((held) => held.tag));
  const blockedBy = new Map<string, readonly string[]>();
  for (const candidate of queue) {
    if (candidate.gate.kind !== "blockedBy") continue;
    blockedBy.set(
      candidate.tag,
      candidate.gate.tags.filter((tag) => stillQueued.has(tag)),
    );
  }
  return { queue, blockedBy, filedAt, inFlight: [] };
}

/** Every pickable `work` entry of a context — the set selection offers. */
const readyIn = (ctx: OrderContext): PendingEntry[] =>
  ctx.queue.filter(
    (candidate) =>
      candidate.kind === "work" &&
      (ctx.blockedBy.get(candidate.tag) ?? []).length === 0,
  );

/**
 * The tags the order serves a queue's ready set in.
 *
 * The vacuity pin rides here rather than in each case: a fixture whose every
 * work entry turned out blocked would order an empty set and agree with any
 * expectation (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
function served(
  queue: readonly PendingEntry[],
  filedAt?: ReadonlyMap<string, number>,
): string[] {
  const ctx = contextFor(queue, filedAt);
  const ready = readyIn(ctx);
  expect(ready.length).toBeGreaterThan(0);
  return queueOrder(ready, ctx).map((picked) => picked.tag);
}

it("work under the first-ranked goal is served before work under the second", () => {
  // The second goal's work is filed older, so every key beneath the goal key
  // pulls the other way.
  expect(
    served(
      [
        entry("FIRST-GOAL", { kind: "group", rank: 1 }),
        entry("FIRST-GOALS-WORK", { parent: "FIRST-GOAL" }),
        entry("SECOND-GOAL", { kind: "group", rank: 2 }),
        entry("SECOND-GOALS-WORK", { parent: "SECOND-GOAL" }),
      ],
      new Map([
        ["FIRST-GOALS-WORK", 2_000],
        ["SECOND-GOALS-WORK", 1_000],
      ]),
    ),
  ).toEqual(["FIRST-GOALS-WORK", "SECOND-GOALS-WORK"]);
});

it("everything a goal's work is blockedBy is served with that goal's work", () => {
  // The goal's own work is blocked, so what the first goal contributes to the
  // ready set is its upstream alone — one blocker directly, one reached
  // through a blocker of its own.
  expect(
    served(
      [
        entry("FIRST-GOAL", { kind: "group", rank: 1 }),
        entry("FIRST-GOALS-WORK", {
          parent: "FIRST-GOAL",
          blockedBy: ["NEAR-UPSTREAM", "HELD-UPSTREAM"],
        }),
        entry("HELD-UPSTREAM", { blockedBy: ["DEEP-UPSTREAM"] }),
        entry("NEAR-UPSTREAM"),
        entry("DEEP-UPSTREAM"),
        entry("SECOND-GOAL", { kind: "group", rank: 2 }),
        entry("SECOND-GOALS-WORK", { parent: "SECOND-GOAL" }),
        entry("UNGOALED-WORK"),
      ],
      // Both upstream entries are the newest things in the queue, so filing
      // would have served them last.
      new Map([
        ["UNGOALED-WORK", 1_000],
        ["SECOND-GOALS-WORK", 2_000],
        ["DEEP-UPSTREAM", 9_000],
        ["NEAR-UPSTREAM", 9_001],
      ]),
    ),
  ).toEqual([
    // Two work entries wait behind the deep one, one behind the near one.
    "DEEP-UPSTREAM",
    "NEAR-UPSTREAM",
    "SECOND-GOALS-WORK",
    "UNGOALED-WORK",
  ]);
});

it("work under no goal is served behind every goal's work", () => {
  // The ungoaled entry is the oldest filing in the queue and has the longest
  // line of work behind it; the goal's work has neither.
  expect(
    served(
      [
        entry("A-GOAL", { kind: "group", rank: 1 }),
        entry("GOALS-WORK", { parent: "A-GOAL" }),
        entry("UNGOALED-WORK"),
        entry("WAITING-ONE", { blockedBy: ["UNGOALED-WORK"] }),
        entry("WAITING-TWO", { blockedBy: ["WAITING-ONE"] }),
      ],
      new Map([
        ["UNGOALED-WORK", 1_000],
        ["GOALS-WORK", 5_000],
      ]),
    ),
  ).toEqual(["GOALS-WORK", "UNGOALED-WORK"]);
});

it("among ungoaled work the longest dependent chain is served first", () => {
  // No goal stands in this queue, so the chain key decides it — against a
  // filing order that is exactly its reverse.
  expect(
    served(
      [
        entry("THREE-WAIT-BEHIND"),
        entry("LINK-ONE", { blockedBy: ["THREE-WAIT-BEHIND"] }),
        entry("LINK-TWO", { blockedBy: ["LINK-ONE"] }),
        entry("LINK-THREE", { blockedBy: ["LINK-TWO"] }),
        entry("ONE-WAITS-BEHIND"),
        entry("LONE-WAITER", { blockedBy: ["ONE-WAITS-BEHIND"] }),
        entry("NONE-WAIT-BEHIND"),
      ],
      new Map([
        ["NONE-WAIT-BEHIND", 1_000],
        ["ONE-WAITS-BEHIND", 2_000],
        ["THREE-WAIT-BEHIND", 3_000],
      ]),
    ),
  ).toEqual(["THREE-WAIT-BEHIND", "ONE-WAITS-BEHIND", "NONE-WAIT-BEHIND"]);
});

it("equal dependent chains break on oldest filing, then tag", () => {
  // Three ready entries with exactly one work entry waiting behind each, so
  // the chain key ties and the default comparator decides. The oldest filing
  // sorts last by tag, which is what keeps the case from passing on the
  // tiebreak alone.
  expect(
    served(
      [
        entry("ZZZ-FILED-FIRST"),
        entry("WAITS-ON-ZZZ", { blockedBy: ["ZZZ-FILED-FIRST"] }),
        entry("TIED-AAA"),
        entry("WAITS-ON-AAA", { blockedBy: ["TIED-AAA"] }),
        entry("TIED-BBB"),
        entry("WAITS-ON-BBB", { blockedBy: ["TIED-BBB"] }),
      ],
      new Map([
        ["ZZZ-FILED-FIRST", 1_000],
        ["TIED-AAA", 2_000],
        ["TIED-BBB", 2_000],
      ]),
    ),
  ).toEqual(["ZZZ-FILED-FIRST", "TIED-AAA", "TIED-BBB"]);
});

it("where an entry came from never orders it", () => {
  // One queue, twice: the second spelling gives the entry the order serves
  // last every mark of urgency a producer could put on an entry file — a
  // rank-shaped field of its own, a cite into a downstream report, a
  // recorded source — and hands the hook its ready set reversed.
  const plain = [
    entry("A-GOAL", { kind: "group", rank: 1 }),
    entry("GOALS-WORK", { parent: "A-GOAL" }),
    entry("UNGOALED-WORK"),
  ];
  const filedAt = new Map([
    ["GOALS-WORK", 5_000],
    ["UNGOALED-WORK", 1_000],
  ]);
  const provenance = {
    priority: 99,
    source: "a downstream report",
    per: { path: "docs/CHAIN-AUTHORING.md", section: "Ordering the queue" },
  };
  const dressed = [
    entry("UNGOALED-WORK", { extra: provenance }),
    entry("GOALS-WORK", { parent: "A-GOAL" }),
    entry("A-GOAL", { kind: "group", rank: 1 }),
  ];

  expect(served(plain, filedAt)).toEqual(["GOALS-WORK", "UNGOALED-WORK"]);
  expect(served(dressed, filedAt)).toEqual(["GOALS-WORK", "UNGOALED-WORK"]);
});

it("the package's order returns a permutation of the entries it was handed", () => {
  const ctx = contextFor(
    [
      entry("A-GOAL", { kind: "group", rank: 2 }),
      entry("GOALS-WORK", { parent: "A-GOAL", blockedBy: ["AN-UPSTREAM"] }),
      entry("GOALS-STEP", { parent: "GOALS-WORK", kind: "step" }),
      entry("AN-UPSTREAM"),
      entry("ANOTHER-GOAL", { kind: "group" }),
      entry("OTHER-GOALS-WORK", { parent: "ANOTHER-GOAL" }),
      entry("UNGOALED-WORK"),
      entry("WAITS-BEHIND", { blockedBy: ["UNGOALED-WORK"] }),
    ],
    new Map([
      ["AN-UPSTREAM", 4_000],
      ["OTHER-GOALS-WORK", 3_000],
      ["UNGOALED-WORK", 2_000],
    ]),
  );
  const ready = readyIn(ctx);
  expect(ready.length).toBeGreaterThan(0);

  const ordered = queueOrder(ready, ctx);
  // Length, membership, and identity in turn: the same tags in some order is
  // the claim, and the entries are the engine's own objects rather than
  // copies the hook composed, so each handed entry is asserted present by
  // identity and the set size is what refuses a repeat.
  expect(ordered).toHaveLength(ready.length);
  expect(ordered.map((picked) => picked.tag).sort()).toEqual(
    ready.map((candidate) => candidate.tag).sort(),
  );
  expect(new Set(ordered).size).toBe(ready.length);
  for (const handed of ready) expect(ordered).toContain(handed);
});
