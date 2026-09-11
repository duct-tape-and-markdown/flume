/**
 * Fast-lane shape pins over the shipped example chains. Everything here is a
 * pure read of the chain object a factory returns — no fixture repo, no
 * subprocess — so it belongs in the default `vitest run` lane rather than
 * beside the tick-cycle drives in `examples.integration.test.ts`.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Chain } from "../src/Phase.ts";
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
  const chains: Chain[] = [
    cascadeChain,
    backlogGroomerFactory(buildFlumeApi(EXAMPLE_PATHS)).chain,
    minimalFactory(buildFlumeApi(EXAMPLE_PATHS)).chain,
  ];

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
