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
 */

import { describe, expect, it } from "vitest";

import { judgeNamedLines, type RunResult, type Runner, type TestFailure } from "../harness/index.ts";

const BASE_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const CWD = "/tmp/a-tree";

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
    failingFiles: [...new Set(failures.map((f) => f.file))],
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
        failingFiles: [],
      }),
      runAtBase: async () => {
        throw new Error("unreachable");
      },
    };

    await expect(
      judgeNamedLines(runner, { tests: [line], pins: [], baseSha: BASE_SHA, cwd: CWD }),
    ).rejects.toThrow(/reported no result for the named line/);
  });
});
