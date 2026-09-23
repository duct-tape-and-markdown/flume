/**
 * The harness package's judge (`spec/harness.md`, *The judges*), driven over
 * a runner that records what it was asked.
 *
 * The runner here is a stand-in, and deliberately so. The seam between a
 * runner and a real test tool is an agreement claim, and it is pinned where
 * the real writer runs: `harnessRunner.test.ts` drives vitest's own reporter
 * through the real reader, and drives this judge over that runner end to end
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). What this file judges is the ruling — which line is refused, which
 * lane reaches the base, what an empty entry costs — and a ruling's input is
 * the typed `RunResult`, not a tool's output. The
 * stand-in matches a line to a passing test by the same containment rule the
 * interface states, so the judge sees the vocabulary it will see in
 * production.
 *
 * The gate the ruling reaches a dispatcher through (`harness/judgeGate.ts`) is
 * driven here too, over the same stand-in. Its subject is the translation —
 * which ruling becomes which `GateResult`, and what discriminant a refusal
 * carries — whose input is a typed verdict, not a tool's output.
 */

import { describe, expect, it } from "vitest";

import { judgeNamedLines, type RunResult, type Runner, type TestFailure } from "../harness/index.ts";
import { namedLinesGate } from "../harness/judgeGate.ts";
import type { GateContext } from "../src/Gate.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";

const BASE_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const CWD = "/tmp/a-tree";
/**
 * The span's footprint in most cases below: a source file and the test file
 * its own named lines live in. A failing file outside it is the shape a red
 * base is asked about.
 */
const FOOTPRINT = ["src/widget.ts", "tests/widget.test.ts"];

/** A suite as the stand-in holds it: which full names passed, and where. */
interface FakeSuite {
  readonly passing: readonly { readonly fullName: string; readonly file: string }[];
  readonly failures?: readonly TestFailure[];
}

/** What the stand-in was asked, so a test can assert on the asking. */
interface Asked {
  readonly run: { readonly names: readonly string[]; readonly cwd: string }[];
  readonly runAtBase: {
    readonly names: readonly string[];
    readonly files: readonly string[];
    readonly baseSha: string;
    readonly cwd: string;
  }[];
}

/**
 * One suite's answer for a set of names, by the rule `runner.ts` states: a
 * name is carried when a passing test's full name contains it.
 */
const answer = (suite: FakeSuite, names: readonly string[]): RunResult => {
  const failures = suite.failures ?? [];
  return {
    ok: failures.length === 0,
    passed: suite.passing.length,
    failed: failures.length,
    names: names.map((name) => {
      const files = [
        ...new Set(suite.passing.filter((p) => p.fullName.includes(name)).map((p) => p.file)),
      ];
      return { name, carried: files.length > 0, files };
    }),
    failures,
  };
};

const fakeRunner = (
  merged: FakeSuite,
  atBase?: FakeSuite,
): { runner: Runner; asked: Asked } => {
  const asked: Asked = { run: [], runAtBase: [] };
  const runner: Runner = {
    lanes: [{ name: "default", excludes: [], runs: true }],
    run: async (names, cwd) => {
      asked.run.push({ names, cwd });
      return answer(merged, names);
    },
    runAtBase: async (names, files, baseSha, cwd) => {
      asked.runAtBase.push({ names, files, baseSha, cwd });
      if (!atBase) throw new Error("the base run happened, and this case declared no base suite");
      return answer(atBase, names);
    },
  };
  return { runner, asked };
};

describe("the judge", () => {
  it("a tests[] line no passing test carries is refused, naming the line", async () => {
    const line = "the widget refuses a negative count";
    const { runner, asked } = fakeRunner({
      passing: [
        { fullName: "widget > carries a count", file: "tests/widget.test.ts" },
        { fullName: "widget > renders", file: "tests/widget.test.ts" },
      ],
    });

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    // Vacuity: the suite the refusal is read off actually ran tests, so the
    // refusal is "no test carries the line", not "no test ran at all".
    expect(verdict.passed).toBeGreaterThan(0);

    expect(verdict.outcome).toBe("unnamed");
    expect(verdict.lines).toEqual([
      { line, lane: "tests", state: "unnamed", files: [] },
    ]);
    expect(verdict.message).toContain(line);
    // Nothing to lay over the base: the refusal is settled on the merged tree.
    expect(asked.runAtBase).toEqual([]);
  });

  it("a tests[] line already green at the base is reported as a named fact", async () => {
    const stale = "the widget clamps at zero";
    const fresh = "the widget refuses a negative count";
    const { runner, asked } = fakeRunner(
      {
        passing: [
          { fullName: `widget > ${stale}`, file: "tests/widget.test.ts" },
          { fullName: `widget > ${fresh}`, file: "tests/widget.test.ts" },
        ],
      },
      { passing: [{ fullName: `widget > ${stale}`, file: "tests/widget.test.ts" }] },
    );

    const verdict = await judgeNamedLines(runner, {
      tests: [stale, fresh],
      pins: [],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    // Vacuity: both lines were carried on the merged tree, so the base run is
    // what separated them — not a line that never had a test.
    expect(verdict.lines.every((l) => l.files.length > 0)).toBe(true);
    expect(asked.runAtBase).toEqual([
      { names: [stale, fresh], files: ["tests/widget.test.ts"], baseSha: BASE_SHA, cwd: CWD },
    ]);

    // The fact is structured, per line: a caller reads which line was already
    // green rather than pattern-matching the message for it.
    expect(verdict.outcome).toBe("green-on-base");
    expect(verdict.lines.filter((l) => l.state === "green-on-base").map((l) => l.line)).toEqual([
      stale,
    ]);
    expect(verdict.lines.filter((l) => l.state === "proven").map((l) => l.line)).toEqual([fresh]);
  });

  it("a pins[] line is judged on the merged tree and never run at the base", async () => {
    const test = "the widget refuses a negative count";
    const pin = "every declared option has a doc comment";
    const { runner, asked } = fakeRunner(
      {
        passing: [
          { fullName: `widget > ${test}`, file: "tests/widget.test.ts" },
          { fullName: `docs > ${pin}`, file: "tests/docs.test.ts" },
        ],
      },
      // The base carries the pin too — and it makes no difference, because
      // the judge never asks about it there.
      { passing: [{ fullName: `docs > ${pin}`, file: "tests/docs.test.ts" }] },
    );

    const verdict = await judgeNamedLines(runner, {
      tests: [test],
      pins: [pin],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    expect(verdict.outcome).toBe("proven");
    expect(verdict.lines).toEqual([
      { line: test, lane: "tests", state: "proven", files: ["tests/widget.test.ts"] },
      { line: pin, lane: "pins", state: "proven", files: ["tests/docs.test.ts"] },
    ]);

    // Vacuity: the base run happened at all, so "the pin was not asked about
    // there" is an exclusion rather than a run that never occurred.
    expect(asked.runAtBase).toHaveLength(1);
    expect(asked.runAtBase[0]?.names).toEqual([test]);
    expect(asked.runAtBase[0]?.names).not.toContain(pin);
    // Nor do the pin's bytes reach the base checkout.
    expect(asked.runAtBase[0]?.files).toEqual(["tests/widget.test.ts"]);
  });

  it("a judge over no named lines reports the empty case rather than a green verdict", async () => {
    const { runner, asked } = fakeRunner({
      passing: [
        { fullName: "widget > carries a count", file: "tests/widget.test.ts" },
        { fullName: "widget > renders", file: "tests/widget.test.ts" },
      ],
    });

    const verdict = await judgeNamedLines(runner, {
      tests: [],
      pins: [],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    // The suite is green and populated — everything that would make a green
    // verdict tempting is true, and the judge still refuses to claim one,
    // because it judged nothing.
    expect(verdict.passed).toBeGreaterThan(0);
    expect(verdict.failures).toEqual([]);
    expect(verdict.outcome).toBe("empty");
    expect(verdict.outcome).not.toBe("proven");
    expect(verdict.lines).toEqual([]);
    expect(asked.runAtBase).toEqual([]);
  });

  it("reports a failing suite as the suite's failure, not as a missing test", async () => {
    const line = "the widget refuses a negative count";
    const { runner, asked } = fakeRunner({
      passing: [{ fullName: `widget > ${line}`, file: "tests/widget.test.ts" }],
      failures: [{ file: "tests/other.test.ts", name: "other > adds", message: "expected 1 to be 2" }],
    });

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha: BASE_SHA,
      // The failing file is the span's own, so the ruling is settled here and
      // no base run is asked for — the case's subject is the merged-tree
      // reading, and the blame arm has its own case below.
      footprint: [...FOOTPRINT, "tests/other.test.ts"],
      cwd: CWD,
    });

    expect(verdict.outcome).toBe("suite-failed");
    expect(verdict.failingFiles).toEqual(["tests/other.test.ts"]);
    // The line was carried; the judge says so, and says the base was never
    // consulted, rather than ruling on evidence a red suite undermines.
    expect(verdict.lines).toEqual([
      { line, lane: "tests", state: "carried", files: ["tests/widget.test.ts"] },
    ]);
    expect(asked.runAtBase).toEqual([]);
  });

  /** A cite pin failing in a file no span below declares — the measured shape. */
  const INHERITED: TestFailure = {
    file: "tests/cite.test.ts",
    name: "comment citations > every backticked page name resolves",
    message: "expected 0 unresolved citations, got 1",
  };

  it("a red suite whose failing files the span never touched is ruled base-red", async () => {
    const line = "the widget refuses a negative count";
    const { runner, asked } = fakeRunner(
      {
        passing: [{ fullName: `widget > ${line}`, file: "tests/widget.test.ts" }],
        failures: [INHERITED],
      },
      // The same failure at the base. The span's footprint never named that
      // file, so what `runAtBase` lays over the base checkout is the copy the
      // base already held, and the verdict is the base's own.
      { passing: [], failures: [INHERITED] },
    );

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    // Vacuity: the merged-tree run really failed, in a file the footprint
    // really excludes, and the base run really happened over exactly it —
    // asking about no named line, since the question there is the file's.
    expect(verdict.failingFiles).toEqual(["tests/cite.test.ts"]);
    expect(FOOTPRINT).not.toContain("tests/cite.test.ts");
    expect(asked.runAtBase).toEqual([
      { names: [], files: ["tests/cite.test.ts"], baseSha: BASE_SHA, cwd: CWD },
    ]);

    expect(verdict.outcome).toBe("base-red");
    // None of the red is the span's, and the base's failures are on the
    // verdict for a caller to act on rather than inside its prose.
    expect(verdict.ownFailingFiles).toEqual([]);
    expect(verdict.baseFailures).toEqual([INHERITED]);
    expect(verdict.message).toContain(BASE_SHA.slice(0, 7));
    // Still a refusal, and the merged-tree line state is unchanged by it: the
    // entry is unjudgeable on a red tree whoever made it red.
    expect(verdict.lines).toEqual([
      { line, lane: "tests", state: "carried", files: ["tests/widget.test.ts"] },
    ]);
  });

  it("a red suite whose failing file the span touched stays the span's own failure", async () => {
    const line = "the widget refuses a negative count";
    const own = "tests/widget.test.ts";
    const { runner, asked } = fakeRunner({
      passing: [{ fullName: `widget > ${line}`, file: own }],
      failures: [
        { file: own, name: "widget > clamps at zero", message: "expected 0 to be 1" },
        INHERITED,
      ],
    });

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    // Vacuity: two files failed and one of them is the span's own — the mixed
    // case, where a base run would answer a question nobody asked.
    expect(verdict.failingFiles).toEqual([own, "tests/cite.test.ts"]);
    expect(verdict.ownFailingFiles).toEqual([own]);

    expect(verdict.outcome).toBe("suite-failed");
    // No base run is spent: laying the span's own bytes over the base would
    // carry its breakage there and report it back as the base's.
    expect(asked.runAtBase).toEqual([]);
    expect(verdict.baseFailures).toEqual([]);
  });

  it("a red suite green at the base names the span rather than leaving the reading open", async () => {
    const line = "the widget refuses a negative count";
    // The span changed source; a test file it never declared broke on the
    // change. Outside the footprint, and the base run settles it.
    const { runner, asked } = fakeRunner(
      {
        passing: [{ fullName: `widget > ${line}`, file: "tests/widget.test.ts" }],
        failures: [INHERITED],
      },
      { passing: [{ fullName: INHERITED.name!, file: INHERITED.file }] },
    );

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha: BASE_SHA,
      footprint: FOOTPRINT,
      cwd: CWD,
    });

    // Vacuity: the base run happened and came back green, so the ruling below
    // is the answer to it rather than the answer to no run at all.
    expect(asked.runAtBase).toHaveLength(1);
    expect(verdict.baseFailures).toEqual([]);

    expect(verdict.outcome).toBe("suite-failed");
    expect(verdict.message).toContain("green at");
    expect(verdict.message).toContain(BASE_SHA.slice(0, 7));
  });

  it("the judge names its failing files from the failures the run reported", async () => {
    const line = "the widget refuses a negative count";
    // Two failures in one file and one in another, out of alphabetical
    // order: the blame list is the failures' files deduplicated in report
    // order, and nothing the runner could have said beside them.
    const { runner } = fakeRunner({
      passing: [{ fullName: `widget > ${line}`, file: "tests/widget.test.ts" }],
      failures: [
        { file: "tests/zebra.test.ts", name: "zebra > stripes", message: "expected 1 to be 2" },
        { file: "tests/apple.test.ts", name: "apple > core", message: "expected 3 to be 4" },
        { file: "tests/zebra.test.ts", name: "zebra > hooves", message: "expected 5 to be 6" },
      ],
    });

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha: BASE_SHA,
      // Both failing files are the span's own: the subject here is the blame
      // list's order, not what a base run would say about it.
      footprint: [...FOOTPRINT, "tests/zebra.test.ts", "tests/apple.test.ts"],
      cwd: CWD,
    });

    // Vacuity: the run the blame list is read off actually reported
    // failures, so the assertion below is over evidence rather than zero.
    expect(verdict.failures).toHaveLength(3);
    expect(verdict.failingFiles).toEqual(["tests/zebra.test.ts", "tests/apple.test.ts"]);
  });

  it("refuses loudly when the runner answers fewer names than it was asked", async () => {
    const line = "the widget refuses a negative count";
    const runner: Runner = {
      lanes: [{ name: "default", excludes: [], runs: true }],
      run: async () => ({
        ok: true,
        passed: 1,
        failed: 0,
        names: [],
        failures: [],
      }),
      runAtBase: async () => {
        throw new Error("unreachable");
      },
    };

    await expect(
      judgeNamedLines(runner, {
        tests: [line],
        pins: [],
        baseSha: BASE_SHA,
        footprint: FOOTPRINT,
        cwd: CWD,
      }),
    ).rejects.toThrow(/reported no result for the named line/);
  });
});

/**
 * Everything a gate context states, with the two fields these cases vary
 * left to the caller. Hand-authored, and the sanctioned kind: the subject is
 * the gate's refusal vocabulary, and a refusal test's input is not an
 * agreement claim (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*).
 */
const gateContext = (
  over: Pick<GateContext, "entry" | "touchedPaths">,
): GateContext => ({
  cwd: CWD,
  repoRoot: CWD,
  flumeDir: `${CWD}/.flume`,
  stateRootRel: ".flume",
  pendingPath: `${CWD}/.flume/plan/pending.json`,
  configDir: `${CWD}/.flume`,
  phaseName: "build",
  commitSha: "a".repeat(40),
  baseSha: BASE_SHA,
  landedOnSha: "b".repeat(40),
  log: () => {},
  ...over,
});

/** The entry a span was provisioned for, naming one behavior. */
const entryNaming = (line: string): PendingEntry => ({
  tag: "SOME-ENTRY",
  gate: { kind: "open" },
  dependsOnForks: [],
  files: { new: [], edit: [], retire: [] },
  tests: [line],
  pins: [],
});

describe("the named-lines gate", () => {
  const line = "the widget refuses a negative count";
  const inherited: TestFailure = {
    file: "tests/cite.test.ts",
    name: "comment citations > every backticked page name resolves",
    message: "expected 0 unresolved citations, got 1",
  };
  /** A red merged suite, failing the same way at the base. */
  const redBoth = (): Runner =>
    fakeRunner(
      {
        passing: [{ fullName: `widget > ${line}`, file: "tests/widget.test.ts" }],
        failures: [inherited],
      },
      { passing: [], failures: [inherited] },
    ).runner;

  it("the named-lines gate reports base-red as its verdict when the judge ruled the base red", async () => {
    const result = await namedLinesGate(redBoth(), () => false).run(
      gateContext({ entry: entryNaming(line), touchedPaths: ["src/widget.ts"] }),
    );

    // Vacuity: the judge ran. A skipped gate carries `skipped` and none of
    // the evidence below, so a green-over-nothing cannot read as this.
    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(false);

    // The discriminant the dispatcher copies verbatim onto the gate row and
    // onto the `gate-revert` prior-attempt record: the retry reads the fact
    // beside the message rather than being blamed by it.
    expect(result.verdict).toBe("base-red");
    // And the base's own failure reaches the agent as its own detail line,
    // marked as the base's rather than folded into the merged tree's list.
    expect(result.details?.split("\n")).toContain(
      `FAIL AT BASE ${inherited.file} × ${inherited.name}: ${inherited.message}`,
    );
    expect(result.failingFiles).toEqual([inherited.file]);
  });

  it("hands the span's footprint to the judge, so a failing file the span touched carries no base-red", async () => {
    // The same runner and the same entry; only the span's touched paths
    // differ. Without the footprint reaching the judge, this would rule
    // base-red exactly as the case above does.
    const result = await namedLinesGate(redBoth(), () => false).run(
      gateContext({
        entry: entryNaming(line),
        touchedPaths: ["src/widget.ts", inherited.file],
      }),
    );

    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.verdict).toBeUndefined();
    // Read off the detail lines rather than the whole block: an absence
    // asserted over a rendered artifact turns on whatever else that artifact
    // quotes (`.claude/rules/posture-sweep.md`, *A negative assertion over a
    // whole rendered artifact*).
    expect(
      (result.details ?? "").split("\n").filter((l) => l.startsWith("FAIL AT BASE")),
    ).toEqual([]);
    // Non-vacuous: the block really was rendered, and really does carry the
    // merged tree's failure — the base's is the one thing missing from it.
    expect((result.details ?? "").split("\n").filter((l) => l.startsWith("FAIL "))).toEqual([
      `FAIL ${inherited.file} × ${inherited.name}: ${inherited.message}`,
    ]);
  });
});
