/**
 * The order the harness package serves the queue in (`harness/order.ts`;
 * `spec/harness.md`, *The phases*): each key of it, and the permutation the
 * engine refuses a hook without.
 *
 * **Every context a case orders over is one the engine composed.** The queue
 * is written into a real repository as entry files and filed by real commits;
 * the engine's own decide-read parses it off the committed tip and reads its
 * filing times off git (`readPendingForDecision`, `src/pendingLedger.ts`);
 * and the engine's own selection picks the ready set and hands the hook the
 * context (`pickableSelection`, `src/selection.ts`). So the `blockedBy` graph
 * these cases order over is the one the engine's composition rule produced,
 * and a change to that rule reds them. A map spelled here by the same rule
 * would be two spellings of one truth, each green while the other moved
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * Each key is driven with the keys *beneath* it set against it: the goal case
 * files the second goal's work older, the chain case files the longest
 * chain's entry newest. A case that let the lower keys agree would pass over
 * an order that read only one of them.
 *
 * What the engine does with the returned sequence, and the refusal it raises
 * over a hook that drops or adds an entry, is `tests/Dispatcher.test.ts`'s
 * subject; the wiring of this hook onto the package's chain is
 * `tests/harnessChain.test.ts`'s. What is judged here is the policy.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { entryExtension, GOAL_RANK_FIELD } from "../harness/entryExtension.ts";
import { queueOrder } from "../harness/order.ts";
import { resolvePendingDir } from "../src/paths.ts";
import { readPendingForDecision } from "../src/pendingLedger.ts";
import type { EntryExtension, PendingEntry } from "../src/PendingSchema.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import type { OrderContext } from "../src/Phase.ts";
import { pickableSelection } from "../src/selection.ts";
import { silent } from "./helpers/dispatcherFixture.ts";
import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import { commitInto } from "./helpers/scratchRepo.ts";
import { exec, SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// Every case files its queue with real commits, so this file starts processes
// and declares the lane's one budget — cases and hooks alike — once here
// rather than inheriting the runner's default (`SPAWN_BUDGET_MS`,
// `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

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
 * every case built from it. Written to disk as it stands and read back
 * through the engine's parse, so a field this builder spells that no schema
 * admits is a refusal rather than a value the order quietly reads.
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
 * The extension every queue below is parsed through: the package's own
 * fields, plus the two provenance-shaped fields one case files an entry with.
 *
 * The queue parse is strict (`src/PendingSchema.ts`) and the package declares
 * no provenance field, so a consumer declaring one is the only way a queue
 * can carry it at all — which is exactly the channel a producer would reach
 * for and the order must not read.
 */
const EXTENSION: EntryExtension = entryExtension({
  priority: {
    schema: z.number().int().optional(),
    hint: `a producer's own urgency — declared by this fixture, ordered by nothing`,
  },
  source: {
    schema: z.string().min(1).optional(),
    hint: `where the entry came from — declared by this fixture, ordered by nothing`,
  },
});

/**
 * The phase the decide-read is taken for. It reaches only that read's
 * parse-failure arm — the fence verdict a repair would need — and every queue
 * below parses, which {@link serve} asserts rather than assumes.
 */
const READING_PHASE = { name: "probe", writablePaths: [] };

/** The clock the fixture's filing commits are dated from. */
const BASE_SECONDS = Date.parse("2024-01-01T00:00:00Z") / 1000;

/** The instant a case's filing mark stands for, in the seconds git answers `%ct` with. */
const secondsFor = (mark: number): number => BASE_SECONDS + mark;

/**
 * The mark an entry no case gave one gets: after every marked entry in its
 * queue. On disk every committed entry has a filing time, so "no mark" is the
 * newest filing rather than the absent one an in-memory map can spell — which
 * is where the default order puts an unfiled entry anyway (`byFilingThenTag`,
 * `src/filingOrder.ts`).
 */
const UNMARKED = 1_000_000;

/** The repository this case's queues are filed into — fresh per case. */
let repo: string;
/** How many queues this case has filed; each gets a declared directory of its own. */
let filed: number;

beforeEach(async () => {
  repo = await mkFixtureRoot("flume-harness-order-");
  await commitInto(repo, { "README.md": "seed\n" });
  filed = 0;
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

/**
 * Write every entry of `queue` into `pendingDir` and file it with a real
 * commit: one commit per distinct mark, oldest first, dated so git answers
 * `%ct` with that mark's instant (`addedPathTimes`, `src/git.ts`).
 *
 * Committed, never left on the working tree: every queue read a selection is
 * taken over resolves the committed tip (`spec/pending.md`, *Dispatch reads
 * come from the tip, not the tree*), so an uncommitted seed would be a queue
 * the engine cannot see and an order over nothing.
 */
async function fileQueue(
  pendingDir: string,
  queue: readonly PendingEntry[],
  filedAt: ReadonlyMap<string, number>,
): Promise<void> {
  await mkdir(pendingDir, { recursive: true });
  const waves = new Map<number, PendingEntry[]>();
  for (const held of queue) {
    const mark = filedAt.get(held.tag) ?? UNMARKED;
    const wave = waves.get(mark);
    if (wave === undefined) waves.set(mark, [held]);
    else wave.push(held);
  }
  for (const mark of [...waves.keys()].sort((a, b) => a - b)) {
    for (const held of waves.get(mark) ?? []) {
      await writeFile(
        join(pendingDir, entryFileName(held.tag)),
        `${JSON.stringify(held, null, 2)}\n`,
        "utf8",
      );
    }
    const at = `${secondsFor(mark)} +0000`;
    await exec("git", ["add", "-A"], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", `file at ${mark}`], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
    });
  }
}

/** What the engine's selection served, and what it served it from. */
interface ServedQueue {
  /** The tags the package's order served the ready set in. */
  readonly tags: string[];
  /** The context the engine handed the hook — the case never builds one. */
  readonly handed: OrderContext;
  /** The ready set the engine handed the hook, as it handed it. */
  readonly ready: readonly PendingEntry[];
  /** What the hook answered, before the engine mapped it back to its own entries. */
  readonly returned: readonly PendingEntry[];
}

/**
 * File `queue` into the fixture repository and take the engine's own
 * selection over it with the package's order as the chain's policy.
 *
 * Nothing here composes a fact the engine holds: the entries come back from
 * the engine's decide-read of the committed tip, the filing times from its
 * read of git, the ready set from its gate switch, and the `blockedBy` graph
 * from its own composition inside `orderedForSelection`
 * (`src/selection.ts`). What a case supplies is the queue and when each entry
 * was filed.
 *
 * `filedAt`'s numbers are marks on the fixture's own clock — their order is
 * the whole content, and {@link secondsFor} is what git is dated with.
 *
 * The vacuity pins ride here rather than in each case: a queue the parse
 * refused, a listing short of what the case filed, or a fixture whose every
 * work entry turned out blocked would order an empty set and agree with any
 * expectation (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
async function serve(
  queue: readonly PendingEntry[],
  filedAt: ReadonlyMap<string, number> = new Map(),
): Promise<ServedQueue> {
  filed += 1;
  const flumeDir = join(repo, ".flume");
  // One declared queue directory per call, resolved the way the engine
  // resolves a chain's own `pendingDir`, so two queues in one case never
  // share a filing history.
  const pendingDir = resolvePendingDir(flumeDir, join("plan", `q${filed}`));
  await fileQueue(pendingDir, queue, filedAt);

  const read = await readPendingForDecision(
    {
      repoRoot: repo,
      flumeDir,
      pendingDir,
      entryExtension: EXTENSION,
      log: silent,
    },
    READING_PHASE,
  );
  const spelled = queue.map((held) => held.tag).sort();
  // The queue the engine read is the queue the case filed, and every entry of
  // it carries a filing time: a refused file or a mark that never reached git
  // would leave the order judged over a narrower queue, or over one whose
  // every entry ties, and read as the claim holding.
  expect(read.queueParseFailure).toBeUndefined();
  expect(read.pending.map((held) => held.tag).sort()).toEqual(spelled);
  expect([...read.filingTimes.keys()].sort()).toEqual(spelled);
  for (const [tag, mark] of filedAt) {
    expect(read.filingTimes.get(tag)).toBe(secondsFor(mark));
  }

  let handed: OrderContext | undefined;
  let offered: readonly PendingEntry[] = [];
  let answered: readonly PendingEntry[] = [];
  let consulted = 0;
  const selection = pickableSelection({
    pending: read.pending,
    filingTimes: read.filingTimes,
    isForkResolved: () => true,
    capabilities: new Set(),
    // The chain's own per-entry refusal is not this file's subject, so
    // nothing is refused and the ready set is the gate switch's alone.
    refuses: () => false,
    order: (ready, ctx) => {
      consulted += 1;
      handed = ctx;
      offered = ready;
      answered = queueOrder(ready, ctx);
      return answered;
    },
    inFlight: [],
  });
  if (handed === undefined) {
    throw new Error("the engine's selection never consulted the order");
  }

  expect(consulted).toBe(1);
  expect(selection.pickable.length).toBeGreaterThan(0);
  // The context is the engine's own, by identity: the queue it read off disk
  // and the times it read off git, not copies this file handed in.
  expect(handed.queue).toBe(read.pending);
  expect(handed.filedAt).toBe(read.filingTimes);

  return {
    tags: selection.pickable.map((picked) => picked.tag),
    handed,
    ready: offered,
    returned: answered,
  };
}

/** The tags the engine's selection served a filed queue in. */
const served = async (
  queue: readonly PendingEntry[],
  filedAt?: ReadonlyMap<string, number>,
): Promise<string[]> => (await serve(queue, filedAt)).tags;

it("the package order reads the blockedBy graph the engine's selection composed", async () => {
  // One blocker the queue still holds, one that has already left it: the edge
  // list the engine composes carries the first alone, and the chain-length
  // key reads exactly those edges. So HOLDS-A-LINE is served ahead of the
  // entry nothing waits behind, against a filing order that is the reverse.
  const { tags, handed } = await serve(
    [
      entry("HOLDS-A-LINE"),
      entry("WAITING", { blockedBy: ["HOLDS-A-LINE", "ALREADY-SHIPPED"] }),
      entry("NOTHING-WAITS"),
    ],
    new Map([
      ["NOTHING-WAITS", 1_000],
      ["HOLDS-A-LINE", 2_000],
    ]),
  );

  // Keyed by the entry that declares the gate, and only by it, with the
  // blocker the queue no longer holds dropped — an entry leaving the queue is
  // the settled verdict (`OrderContext.blockedBy`, `src/Phase.ts`). A case
  // that composed this off `gate.tags` would carry ALREADY-SHIPPED here.
  expect([...handed.blockedBy]).toEqual([["WAITING", ["HOLDS-A-LINE"]]]);
  expect(tags).toEqual(["HOLDS-A-LINE", "NOTHING-WAITS"]);
});

it("an order case over a queue with no blocker still receives a context the engine built", async () => {
  // Nothing in this queue declares a blocker, so the graph the engine
  // composes is empty — the one shape a case spelling its own would be
  // indistinguishable from. What the context is held to instead is the rest
  // of it: the whole forest the engine read off disk, the goal among it that
  // the ready set never holds, and the times it read off git.
  const { tags, handed } = await serve(
    [
      entry("A-GOAL", { kind: "group", rank: 1 }),
      entry("GOALS-WORK", { parent: "A-GOAL" }),
      entry("UNGOALED-WORK"),
    ],
    new Map([
      ["GOALS-WORK", 5_000],
      ["UNGOALED-WORK", 1_000],
    ]),
  );

  expect(handed.blockedBy.size).toBe(0);
  // The empty graph is the engine's verdict over a populated queue, not a
  // fixture that produced no entry to compose an edge from.
  expect(handed.queue).toHaveLength(3);
  expect(handed.queue.every((held) => held.gate.kind === "open")).toBe(true);
  expect(handed.queue.map((held) => held.tag).sort()).toEqual([
    "A-GOAL",
    "GOALS-WORK",
    "UNGOALED-WORK",
  ]);
  expect(handed.filedAt.get("UNGOALED-WORK")).toBe(secondsFor(1_000));
  expect(handed.inFlight).toEqual([]);
  expect(tags).toEqual(["GOALS-WORK", "UNGOALED-WORK"]);
});

it("work under the first-ranked goal is served before work under the second", async () => {
  // The second goal's work is filed older, so every key beneath the goal key
  // pulls the other way.
  expect(
    await served(
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

it("everything a goal's work is blockedBy is served with that goal's work", async () => {
  // The goal's own work is blocked, so what the first goal contributes to the
  // ready set is its upstream alone — one blocker directly, one reached
  // through a blocker of its own.
  expect(
    await served(
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

it("work under no goal is served behind every goal's work", async () => {
  // The ungoaled entry is the oldest filing in the queue and has the longest
  // line of work behind it; the goal's work has neither.
  expect(
    await served(
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

it("among ungoaled work the longest dependent chain is served first", async () => {
  // No goal stands in this queue, so the chain key decides it — against a
  // filing order that is exactly its reverse.
  expect(
    await served(
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

it("equal dependent chains break on oldest filing, then tag", async () => {
  // Three ready entries with exactly one work entry waiting behind each, so
  // the chain key ties and the default comparator decides. The oldest filing
  // sorts last by tag, which is what keeps the case from passing on the
  // tiebreak alone.
  expect(
    await served(
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

it("where an entry came from never orders it", async () => {
  // One queue, filed twice: the second spelling gives the entry the order
  // serves last every mark of urgency a producer could put on an entry file —
  // a rank-shaped field of its own, a cite into a downstream report, a
  // recorded source. The engine's selection hands the hook both ready sets in
  // the same order, so provenance is the only difference between them.
  const plain = [
    entry("A-GOAL", { kind: "group", rank: 1 }),
    entry("GOALS-WORK", { parent: "A-GOAL" }),
    entry("UNGOALED-WORK"),
  ];
  const filedAt = new Map([
    ["GOALS-WORK", 5_000],
    ["UNGOALED-WORK", 1_000],
  ]);
  const dressed = [
    entry("UNGOALED-WORK", {
      extra: {
        priority: 99,
        source: "a downstream report",
        per: { path: "docs/CHAIN-AUTHORING.md", section: "Ordering the queue" },
      },
    }),
    entry("GOALS-WORK", { parent: "A-GOAL" }),
    entry("A-GOAL", { kind: "group", rank: 1 }),
  ];

  expect(await served(plain, filedAt)).toEqual(["GOALS-WORK", "UNGOALED-WORK"]);
  const second = await serve(dressed, filedAt);

  // The provenance survived the parse and reached the hook, so the claim is
  // over an entry that carries it rather than over one the schema stripped.
  expect(
    second.handed.queue.find((held) => held.tag === "UNGOALED-WORK"),
  ).toMatchObject({ priority: 99, source: "a downstream report" });
  expect(second.tags).toEqual(["GOALS-WORK", "UNGOALED-WORK"]);
});

it("the package's order returns a permutation of the entries it was handed", async () => {
  const { ready, returned } = await serve(
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

  // Length, membership, and identity in turn, over the set the engine itself
  // offered: the same tags in some order is the claim, and the entries are
  // the engine's own objects rather than copies the hook composed, so each
  // offered entry is asserted present by identity and the set size is what
  // refuses a repeat.
  expect(ready.length).toBeGreaterThan(0);
  expect(returned).toHaveLength(ready.length);
  expect(returned.map((picked) => picked.tag).sort()).toEqual(
    ready.map((candidate) => candidate.tag).sort(),
  );
  expect(new Set(returned).size).toBe(ready.length);
  for (const candidate of ready) expect(returned).toContain(candidate);
});
