/**
 * Fast-lane shape pins over the shipped example chains. Everything here is a
 * pure read of the chain object a factory returns — no fixture repo, no
 * subprocess — so it belongs in the default `vitest run` lane rather than
 * beside the tick-cycle drives in `examples.integration.test.ts`.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Chain, TickContext } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { PriorAttempt } from "../src/Prompt.ts";
import { buildFlumeApi, type FlumePaths } from "../src/flumeApi.ts";
import backlogGroomerFactory from "../examples/backlog-groomer-chain.ts";
import cascadeFactory from "../examples/cascade-chain.ts";
import minimalFactory from "../examples/minimal-chain.ts";

/** The roots a real tick would resolve for an `examples/`-hosted chain. */
const EXAMPLE_PATHS: FlumePaths = {
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  configDir: fileURLToPath(new URL("../examples", import.meta.url)),
  flumeDir: fileURLToPath(new URL("../.flume", import.meta.url)),
};

const { chain: cascadeChain } = cascadeFactory(buildFlumeApi(EXAMPLE_PATHS));
const { chain: backlogGroomerChain } = backlogGroomerFactory(
  buildFlumeApi(EXAMPLE_PATHS),
);
const { chain: minimalChain } = minimalFactory(buildFlumeApi(EXAMPLE_PATHS));

/**
 * spec/chain.md, *Gate placement is the chain's decision* — expensive
 * correctness gates at `afterMerge`, cheap structural ones at `afterCommit`.
 * The flagship example is read as doctrine, so its own split is pinned: an
 * all-`afterCommit` gate list there teaches the staleness window that section
 * argues against.
 */
describe("cascade-chain.ts — build gates split by cost", () => {
  it("the cascade example places its vitest gate at afterMerge and its type gate at afterCommit", () => {
    const buildPhase = cascadeChain.phases.find((p) => p.name === "build");
    expect(buildPhase).toBeDefined();
    const gates = buildPhase!.gates;
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // the lookups below would every() over nothing if the list were empty,
    // and would silently miss a gate if two shared a name.
    const placement = new Map(gates.map((g) => [g.name, g.when]));
    expect(gates.length).toBeGreaterThan(0);
    expect(placement.size).toBe(gates.length);
    expect([...placement.keys()].sort()).toEqual(["eslint", "tsc", "vitest"]);

    expect(placement.get("vitest")).toBe("afterMerge");
    expect(placement.get("tsc")).toBe("afterCommit");
    expect(placement.get("eslint")).toBe("afterCommit");
  });
});

/**
 * `.claude/rules/engineering.md`, "An export earns its consumer" — a shipped
 * example is public surface, and a phase no consumer runs is residue a chain
 * author reads as the recommended shape. Cascade carried a `spec` phase over
 * a `specs/active` / `specs/_aligned` / `workshop/_archive` partition that no
 * current chain runs; what the flagship teaches is now the plan+build shape
 * flume's own `.flume/chain.ts` dogfoods.
 */
describe("cascade-chain.ts — the shipped phase list", () => {
  it("the cascade example declares plan and build and no spec phase", () => {
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // an empty phase list would satisfy every absence assertion below.
    expect(cascadeChain.phases.length).toBeGreaterThan(0);
    expect(cascadeChain.phases.map((p) => p.name)).toEqual(["plan", "build"]);

    // The retired phase's fence partition goes with it — a `specs/**` or
    // `workshop/**` glob surviving on a sibling phase would keep teaching the
    // corpus layout the cut removed.
    const fence = cascadeChain.phases.flatMap((p) => p.writablePaths);
    expect(fence.length).toBeGreaterThan(0);
    expect(fence.filter((g) => /^(?:specs|workshop)\//.test(g))).toEqual([]);

    // `humanOnly` named the cut phase; nothing else in this chain is
    // human-woken, so the list is empty rather than stale.
    expect(cascadeChain.humanOnly).toEqual([]);
  });
});

/**
 * Agreement pin (engineering.md, "A seam gate reads what the real writer
 * wrote"): `examples/prompts/` ships the prompt files the example chains
 * name, and `Phase.promptPath` is the only thing that names one. A file left
 * behind after its phase is cut is dead weight a reader takes for a live
 * template — the shape no test caught when `prompts/spec.md` outlived
 * nothing.
 *
 * One direction only. The reverse — every `promptPath` resolves to a shipped
 * file — is false by design: `minimal-chain.ts` points at `prompts/notes.md`,
 * which its trailing block tells the copying consumer to author.
 */
describe("examples/prompts — every shipped prompt has a phase that names it", () => {
  const chains: Chain[] = [cascadeChain, backlogGroomerChain, minimalChain];

  it("no prompt file under examples/prompts/ is unreferenced by an example phase", () => {
    const shipped = readdirSync(
      fileURLToPath(new URL("../examples/prompts", import.meta.url)),
    )
      .filter((f) => f.endsWith(".md"))
      .sort();
    const declared = new Set(
      chains.flatMap((c) => c.phases.map((p) => p.promptPath)),
    );
    // Vacuity pin: an empty directory listing, or a chain set that declared
    // no prompts, passes the subset check below over nothing.
    expect(shipped.length).toBeGreaterThan(0);
    expect(declared.size).toBeGreaterThan(0);

    expect(
      shipped.filter((name) => !declared.has(`prompts/${name}`)),
    ).toEqual([]);
  });
});

/**
 * `flume job run` wakes `phases[0]` unconditionally on a cold job (v0.5
 * decision 6, `src/job.ts` `jobRun`) — it has no notion of `humanOnly` at
 * that call site. A chain whose entry phase is also in its own `humanOnly`
 * list declares a job that can never cold-start on its own machinery; a
 * human has to intervene on tick one, every time. Every chain under
 * `examples/` is a "read this to learn the shape" artifact (v0.1 §7 /
 * v0.8 §7), so this pins the entry-phase/humanOnly relationship across all
 * of them, not just cascade.
 */
describe("example chains — entry phase is machine-wakeable", () => {
  const chains: Array<{ name: string; chain: Chain }> = [
    { name: "cascade-chain.ts", chain: cascadeChain },
    { name: "backlog-groomer-chain.ts", chain: backlogGroomerChain },
    { name: "minimal-chain.ts", chain: minimalChain },
  ];

  it.each(chains)(
    "$name: phases[0] is absent from its own humanOnly list",
    ({ chain }) => {
      const entryPhase = chain.phases[0];
      expect(entryPhase).toBeDefined();
      expect(chain.humanOnly).not.toContain(entryPhase!.name);
    },
  );
});

/**
 * v0.8 §6 / engineering.md "The fix lands at the mechanism" — the flagship
 * example hand-rolled a "does pending.json parse" gate that
 * `docs/CHAIN-AUTHORING.md` itself documents as predating the `pendingGate`
 * builtin. Pins the swap: plan's gate list carries `pendingGate`'s identity
 * (`"pending-gate"`), not the hand-rolled gate's name.
 */
describe("cascade-chain.ts — plan phase gates through the pendingGate builtin", () => {
  it("plan.gates contains a gate named 'pending-gate'", () => {
    const planPhase = cascadeChain.phases.find((p) => p.name === "plan");
    expect(planPhase).toBeDefined();
    expect(planPhase!.gates.map((g) => g.name)).toContain("pending-gate");
  });
});

/**
 * spec/chain.md, *What a hook receives* — `shouldRun` is one of the chain's
 * four interpretation points, and the section's own worked case is a plan
 * phase deciding "build has a standing bail to reconcile" off
 * `TickContext.priorAttempts` rather than a `readdirSync` of the engine's
 * directory. No shipped example declared the hook at all, so an adopter
 * learning the shape from `examples/` never saw a phase decline a tick.
 *
 * Both verdicts are driven here: the decline (the queue already carries work
 * build can pick, and nothing stands unreconciled) and the two runs. The
 * fixture's `cwd`/`flumeDir` point at a directory that does not exist —
 * a predicate that scanned disk instead of reading the context would throw
 * or answer differently, so the pin holds the "from `TickContext`" half of
 * the claim too.
 */
describe("cascade-chain.ts — plan decides from the TickContext", () => {
  const planPhase = cascadeChain.phases.find((p) => p.name === "plan");

  const openEntry = (tag: string): PendingEntry => ({
    tag,
    gate: { kind: "open" },
    dependsOnForks: [],
    files: { new: [], edit: [], retire: [] },
  });

  const standingBail: PriorAttempt = {
    mode: "clean-exit",
    finalMessage: "parked: the entry needs a wider fence",
    key: "entry",
    headSha: "0".repeat(40),
    at: "2026-09-11T00:00:00.000Z",
  };

  const ctx = (over: Partial<TickContext>): TickContext => ({
    cwd: "/nonexistent/cascade-shouldRun-fixture",
    flumeDir: "/nonexistent/cascade-shouldRun-fixture/.flume",
    ...over,
  });

  it("the cascade example's plan phase declines a tick when nothing on disk gives it work", () => {
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // an undeclared hook, or an empty `pickable`, would make the decline
    // below assert nothing about a predicate that read the queue.
    expect(planPhase, "cascade declares a plan phase").toBeDefined();
    expect(
      planPhase!.shouldRun,
      "examples/cascade-chain.ts: plan declares `shouldRun` — the hook is " +
        "what this pin exists to drive",
    ).toBeTypeOf("function");

    const pickable = [openEntry("ALREADY-PICKABLE")];
    expect(pickable.length).toBeGreaterThan(0);

    expect(
      planPhase!.shouldRun!(
        ctx({ pending: pickable, pickable, priorAttempts: new Map() }),
      ),
    ).toBe(false);
  });

  it("the cascade example's plan phase runs when the queue is empty or a prior attempt stands", () => {
    expect(planPhase!.shouldRun).toBeTypeOf("function");

    // Nothing build could pick — the queue is plan's to refill.
    expect(
      planPhase!.shouldRun!(
        ctx({ pending: [], pickable: [], priorAttempts: new Map() }),
      ),
    ).toBe(true);

    // Pickable work exists, but a record stands unreconciled: the decline
    // above must not swallow this case.
    const pickable = [openEntry("ALREADY-PICKABLE")];
    const priorAttempts = new Map([["PARKED-ENTRY", standingBail]]);
    expect(priorAttempts.size).toBeGreaterThan(0);
    expect(
      planPhase!.shouldRun!(
        ctx({ pending: pickable, pickable, priorAttempts }),
      ),
    ).toBe(true);
  });
});
