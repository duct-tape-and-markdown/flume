/**
 * `src/gateBatch.ts` — the two halves of "a gate declares whether it reads a
 * batch": the width one merge of a phase may carry, and the context the
 * gates over such a merge are handed (spec/chain.md, *What a gate receives*;
 * spec/worktrees.md, *Batched merges*).
 *
 * Both are pure over values a tick already holds, so every case here drives
 * the real function over a real `Chain`/`Phase` rather than a stub of either:
 * the predicate's whole subject is what a declaration says, and a fixture
 * that invented its own gate shape would pin the fixture.
 */

import { describe, expect, it } from "vitest";

import type { BatchingGate, GateBatchSpan, GateSite, SingleSpanGate } from "../src/Gate.ts";
import {
  chainLoadGate,
  eslintGate,
  pendingGate,
  shellGate,
  tscGate,
  vitestGate,
} from "../src/builtinGates.ts";
import { batchGateContext, mergeBatchWidth } from "../src/gateBatch.ts";
import { runGate, type GateRunScope } from "../src/gateRun.ts";
import type { Chain, Phase } from "../src/Phase.ts";

/** A gate that judges nothing — these cases read its declaration, never its verdict. */
const quiet = async (): Promise<{ ok: true; message: string }> => ({
  ok: true,
  message: "",
});

/** One `afterMerge` gate, declaring whether it reads a batch or not. */
const afterMerge = (name: string, batches: boolean): SingleSpanGate | BatchingGate =>
  batches
    ? ({ name, when: "afterMerge", batches: true, run: quiet } satisfies BatchingGate)
    : ({ name, when: "afterMerge", run: quiet } satisfies SingleSpanGate);

/** A fanout phase carrying the gates a case is about. */
const phaseWith = (gates: Phase["gates"]): Phase => ({
  name: "build",
  description: "",
  promptPath: "prompt.md",
  concurrency: "fanout",
  writablePaths: ["src/**"],
  gates,
  handoff: () => [],
});

/** A chain over that phase, with whatever merge width the case declares. */
const chainWith = (phase: Phase, mergeBatch?: number): Chain => ({
  phases: [phase],
  humanOnly: [],
  ...(mergeBatch === undefined ? {} : { supervisorPolicy: { mergeBatch } }),
});

describe("mergeBatchWidth — the two declarations a batch needs", () => {
  it("the supervisor policy's mergeBatch defaults to 1", () => {
    // Every gate declares it reads a batch, so the gate half is satisfied and
    // the undeclared knob is the only thing deciding — otherwise a green here
    // would be the gate half answering and the default never read.
    const phase = phaseWith([afterMerge("suite", true), afterMerge("lint", true)]);
    expect(phase.gates.every((gate) => gate.batches === true)).toBe(true);

    expect(mergeBatchWidth(chainWith(phase), phase)).toBe(1);
  });

  it("a phase batches only when mergeBatch is above 1 and every afterMerge gate declares batches", () => {
    const phase = phaseWith([
      { name: "tsc", when: "afterCommit", run: quiet },
      afterMerge("suite", true),
      afterMerge("lint", true),
    ]);
    // Non-vacuity: there are `afterMerge` gates to judge, and an
    // `afterCommit` one beside them that must not be consulted.
    expect(phase.gates.filter((gate) => gate.when === "afterMerge")).toHaveLength(2);

    expect(mergeBatchWidth(chainWith(phase, 4), phase)).toBe(4);
  });

  it("a phase whose afterMerge gate does not declare batches is held to one span per merge", () => {
    const phase = phaseWith([afterMerge("suite", true), afterMerge("lint", false)]);
    expect(phase.gates.filter((gate) => gate.when === "afterMerge")).toHaveLength(2);

    expect(mergeBatchWidth(chainWith(phase, 4), phase)).toBe(1);
  });

  it("an afterCommit gate that does not declare batches never narrows the width", () => {
    // The predicate reads the `afterMerge` gates alone: an `afterCommit` gate
    // runs in its own worktree over its own span and is handed no batch ever,
    // so holding the phase back for one would price every tsc gate as a
    // batch reader.
    const phase = phaseWith([
      { name: "tsc", when: "afterCommit", run: quiet },
      afterMerge("suite", true),
    ]);

    expect(mergeBatchWidth(chainWith(phase, 3), phase)).toBe(3);
  });

  it("a phase whose afterMerge gates are shell-backed builtins merges at the declared width", () => {
    // The gates are the engine's own, built through the real factories and
    // relocated to the merge the way a chain relocates them — not a fixture
    // declaring `batches` by the tester's hand, which is what every other
    // case in this describe does and what would pass over a builtin that
    // never made the declaration (`.claude/rules/engineering.md`, *A seam
    // gate reads what the real writer wrote*).
    const phase = phaseWith([
      tscGate({ when: "afterMerge" }),
      vitestGate({ when: "afterMerge" }),
      eslintGate({ when: "afterMerge" }),
      // Named with a path rather than a package manager: nothing here runs
      // the gate, and a bare `"pnpm"` literal would read as a spawn site to
      // the lane's budget pin (`tests/helpers/spawnBudget.ts`) in a file
      // that starts no process.
      shellGate({
        name: "smoke",
        when: "afterMerge",
        cmd: "./scripts/smoke.sh",
        args: [],
      }),
    ]);
    // Non-vacuity: four real `afterMerge` gates, so the width below is their
    // declaration answering rather than an empty gate list's vacuous truth
    // (the case below this one).
    expect(phase.gates.filter((gate) => gate.when === "afterMerge")).toHaveLength(4);

    expect(mergeBatchWidth(chainWith(phase, 4), phase)).toBe(4);
  });

  it("a phase whose only afterMerge gate is the queue gate reaches the declared merge width", () => {
    // The claim check is the reason a chain hangs a second `pendingGate` at
    // the merge (`docs/CHAIN-AUTHORING.md`), so the gate under test is the
    // real factory's own return at that placement — not a fixture declaring
    // `batches` by the tester's hand, which is what the cases above do and
    // what would pass over a builtin that never made the declaration
    // (`.claude/rules/engineering.md`, *A seam gate reads what the real
    // writer wrote*).
    const queue = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      when: "afterMerge",
    });
    const phase = phaseWith([tscGate, queue]);
    // Non-vacuity: the queue gate is the phase's one `afterMerge` gate — so
    // the width below is its declaration answering, not an empty gate list's
    // vacuous truth (the case below this one) — and the declaration it makes
    // is spelled here rather than left to be inferred from the width.
    expect(
      phase.gates
        .filter((gate) => gate.when === "afterMerge")
        .map((gate) => gate.name),
    ).toEqual(["pending-gate"]);
    expect(queue.batches).toBe(true);

    expect(mergeBatchWidth(chainWith(phase, 4), phase)).toBe(4);
  });

  it("a phase whose afterMerge gates include chainLoadGate still merges one span at a time", () => {
    // The gate that re-loads a committed `chain.ts` judges the gated commit
    // as one span's, so it is the one builtin a chain can hang at the merge
    // that holds the phase back — beside a batch-reading sibling, which is
    // what makes the narrowing the undeclared gate's rather than an absent
    // batch reader's.
    const phase = phaseWith([
      afterMerge("suite", true),
      { ...chainLoadGate, when: "afterMerge" },
    ]);
    const atMerge = phase.gates.filter((gate) => gate.when === "afterMerge");
    expect(atMerge.map((gate) => gate.name)).toEqual(["suite", "chain-load"]);
    expect(atMerge.map((gate) => gate.batches === true)).toEqual([true, false]);

    expect(mergeBatchWidth(chainWith(phase, 4), phase)).toBe(1);
  });

  it("a phase with no afterMerge gate batches at the declared width", () => {
    // Vacuous-by-design, spelled rather than inherited: nothing reads the
    // merge, so nothing can misread a batch.
    const phase = phaseWith([{ name: "tsc", when: "afterCommit", run: quiet }]);
    expect(phase.gates.filter((gate) => gate.when === "afterMerge")).toEqual([]);

    expect(mergeBatchWidth(chainWith(phase, 5), phase)).toBe(5);
  });
});

/** The placement half of a gate context — the same at either width. */
const site: GateSite = {
  cwd: "/repo",
  repoRoot: "/repo",
  flumeDir: "/repo/.flume",
  stateRootRel: ".flume",
  configDir: "/repo/.flume",
  pendingDir: "/repo/.flume/plan/pending",
  phaseName: "build",
  log: () => {},
};

/** One picked span, with only the facts a case varies spelled out. */
const span = (
  commitSha: string,
  baseSha: string,
  landedOnSha: string,
  touchedPaths: string[],
): GateBatchSpan => ({ commitSha, baseSha, landedOnSha, touchedPaths });

describe("batchGateContext — what a merge of several spans hands its gates", () => {
  const spans = [
    span("c1", "base1", "tip0", ["src/a.ts", "README.md"]),
    span("c2", "base2", "c1", ["src/b.ts", "README.md"]),
    span("c3", "base3", "c2", ["src/c.ts"]),
  ];

  it("a batch gate context withholds entry, baseSha and landedOnSha", () => {
    const ctx = batchGateContext(site, spans);

    // Non-vacuity: the spans each carry the three facts, so their absence at
    // the top level is the context withholding them rather than a batch that
    // had none to state.
    expect(ctx.batch).toHaveLength(3);
    expect(ctx.batch.map((s) => s.baseSha)).toEqual(["base1", "base2", "base3"]);
    expect(ctx.batch.map((s) => s.landedOnSha)).toEqual(["tip0", "c1", "c2"]);

    expect(ctx.entry).toBeUndefined();
    expect(ctx.baseSha).toBeUndefined();
    expect(ctx.landedOnSha).toBeUndefined();
  });

  it("a batch gate context's touchedPaths is the union of its spans and commitSha is the batch's last pick", () => {
    const ctx = batchGateContext(site, spans);

    // The union, first-seen order kept, with the path two spans edited named
    // once — a concatenation would carry `README.md` twice and a per-span
    // read would miss two thirds of the tree the gates run over.
    expect(ctx.touchedPaths).toEqual([
      "src/a.ts",
      "README.md",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect(ctx.commitSha).toBe("c3");
  });

  it("a batch gate context carries the placement its gates run at", () => {
    const ctx = batchGateContext(site, spans);

    expect(ctx.cwd).toBe(site.cwd);
    expect(ctx.repoRoot).toBe(site.repoRoot);
    expect(ctx.flumeDir).toBe(site.flumeDir);
    expect(ctx.stateRootRel).toBe(site.stateRootRel);
    expect(ctx.configDir).toBe(site.configDir);
    expect(ctx.pendingDir).toBe(site.pendingDir);
    expect(ctx.phaseName).toBe(site.phaseName);
  });

  it("a batch of no spans refuses rather than composing a context with no tip", () => {
    expect(() => batchGateContext(site, [])).toThrow(
      /phase 'build' from no spans/,
    );
  });
});

/**
 * `runGate` (`src/gateRun.ts`) is the one door a declared gate's `run` is
 * called through, so it is where "only a gate that declares `batches: true`
 * is ever handed one" (spec/chain.md, *What a gate receives*) stops being a
 * type-level claim and becomes a refusal a caller can trip.
 */
describe("runGate — the context shape a gate declared it reads", () => {
  const scope: GateRunScope = {
    worktreeCtx: {
      repoRoot: "/repo",
      flumeDir: "/repo/.flume",
      stateRootRel: ".flume",
      log: { info: () => {}, warn: () => {}, error: () => {} },
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  const batch = batchGateContext(site, [span("c1", "b1", "t0", ["src/a.ts"])]);

  it("a gate declaring batches is handed the batch whole", async () => {
    let seen: number | undefined;
    const gate: BatchingGate = {
      name: "suite",
      when: "afterMerge",
      batches: true,
      run: async (ctx) => {
        seen = ctx.batch?.length;
        return { ok: true, message: "" };
      },
    };

    const { result } = await runGate(gate, batch, scope);

    expect(result.ok).toBe(true);
    expect(seen).toBe(1);
  });

  it("a gate that did not declare batches refuses the batch rather than reading one span as the merge", async () => {
    let ran = false;
    const gate: SingleSpanGate = {
      name: "lint",
      when: "afterMerge",
      run: async () => {
        ran = true;
        return { ok: true, message: "" };
      },
    };

    // The throw is recorded as that gate's own failure, which is how the
    // merge reverts loudly instead of shipping a verdict the gate took over
    // the last pick's facts.
    const { result } = await runGate(gate, batch, scope);

    expect(ran).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/without declaring batches: true/);
  });

  it("a gate declaring batches still reads a single-span context as one span", async () => {
    // The declaration says the gate is able to read a batch, never that it
    // is always handed one: at the default width every merge carries one.
    let sawBatch: unknown;
    const gate: BatchingGate = {
      name: "suite",
      when: "afterMerge",
      batches: true,
      run: async (ctx) => {
        sawBatch = ctx.batch;
        return { ok: ctx.batch === undefined, message: "" };
      },
    };

    const { result } = await runGate(
      gate,
      { ...site, commitSha: "c9", touchedPaths: ["src/a.ts"], baseSha: "b9" },
      scope,
    );

    expect(sawBatch).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});
