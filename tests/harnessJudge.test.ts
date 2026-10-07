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

import {
  judgeNamedLines,
  type JudgeSpan,
  type RunResult,
  type Runner,
  type TestFailure,
} from "../harness/index.ts";
import { namedLinesGate } from "../harness/judgeGate.ts";
import type { GateBatchSpan, GateContext, GateSite } from "../src/Gate.ts";
import { batchGateContext, mergeBatchWidth } from "../src/gateBatch.ts";
import type { Chain, Phase } from "../src/Phase.ts";
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
  /**
   * The full names of cases the suite collected and did not run — what a
   * host-gated case looks like on the host that does not run it. No file
   * rides one: a skipped case carries nothing a base run could lay down
   * (`harness/runner.ts`, `NamedResult`).
   */
  readonly skipped?: readonly string[];
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
      return {
        name,
        carried: files.length > 0,
        skipped: (suite.skipped ?? []).some((fullName) => fullName.includes(name)),
        files,
      };
    }),
    failures,
  };
};

const fakeRunner = (
  merged: FakeSuite,
  /**
   * What the base run finds: one suite for every base, or a function of the
   * base sha where a batch's spans branched from different ones and each tree
   * has its own answer.
   */
  atBase?: FakeSuite | ((baseSha: string) => FakeSuite),
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
      return answer(typeof atBase === "function" ? atBase(baseSha) : atBase, names);
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
      spans: [
        {
          tests: [line],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
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
      spans: [
        {
          tests: [stale, fresh],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
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

  it("a laneTests line carried only by a skipped test reports owed rather than proven", async () => {
    const gated = "walls a worktree path only win32 refuses";
    const here = "the widget refuses a negative count";
    const { runner, asked } = fakeRunner(
      {
        passing: [{ fullName: `widget > ${here}`, file: "tests/widget.test.ts" }],
        // The gated case exists in the suite and did not run — no file, since
        // nothing it holds is laid over a base.
        skipped: [`worktrees > ${gated}`],
      },
      { passing: [] },
    );

    const verdict = await judgeNamedLines(runner, {
      spans: [
        {
          tests: [here],
          pins: [],
          laneTests: [{ lane: "win32", title: gated }],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
      cwd: CWD,
    });

    // Vacuity: the suite ran and this host's own line really was proven, so
    // the ruling below is over a case the run declined rather than over a run
    // that collected nothing.
    expect(verdict.passed).toBeGreaterThan(0);
    expect(verdict.lines.filter((l) => l.state === "proven").map((l) => l.line)).toEqual([
      here,
    ]);

    expect(verdict.outcome).toBe("proven");
    // Owed, and to the lane the entry named — the fact a reader acts on,
    // carried on the line rather than left to a re-join against the entry.
    expect(verdict.lines).toContainEqual({
      line: gated,
      lane: "laneTests",
      state: "owed",
      files: [],
      owedTo: "win32",
    });
    // Never green: this host proved nothing about it, whatever the suite's
    // count says.
    expect(verdict.lines.filter((l) => l.lane === "laneTests" && l.state === "proven")).toEqual(
      [],
    );
    // And never asked at the base: the lane is the proof, so a base run over
    // a case that never ran here would compare two silences.
    expect(asked.runAtBase).toHaveLength(1);
    expect(asked.runAtBase[0]?.names).toEqual([here]);
    expect(verdict.message).toContain("owed to win32");
  });

  it("a laneTests line no test on the build host names is refused as unnamed", async () => {
    const gated = "walls a worktree path only win32 refuses";
    const { runner, asked } = fakeRunner({
      passing: [{ fullName: "widget > renders", file: "tests/widget.test.ts" }],
      // A skip that is not this line's, so the refusal is "no case carries
      // this title" rather than "the suite skipped nothing at all".
      skipped: ["worktrees > a different gated case"],
    });

    const verdict = await judgeNamedLines(runner, {
      spans: [
        {
          tests: [],
          pins: [],
          laneTests: [{ lane: "win32", title: gated }],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
      cwd: CWD,
    });

    // Vacuity: the suite ran, and it skipped a case — so the refusal is the
    // title missing, not the skipped status going unread.
    expect(verdict.passed).toBeGreaterThan(0);

    expect(verdict.outcome).toBe("unnamed");
    expect(verdict.lines).toEqual([
      { line: gated, lane: "laneTests", state: "unnamed", files: [], owedTo: "win32" },
    ]);
    expect(verdict.message).toContain(gated);
    // A host-gated line named by nothing is settled on the merged tree.
    expect(asked.runAtBase).toEqual([]);
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
      spans: [
        {
          tests: [test],
          pins: [pin],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
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
      spans: [
        {
          tests: [],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
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
      spans: [
        {
          tests: [line],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          // The failing file is the span's own, so the ruling is settled here and
          // no base run is asked for — the case's subject is the merged-tree
          // reading, and the blame arm has its own case below.
          footprint: [...FOOTPRINT, "tests/other.test.ts"],
        },
      ],
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
      spans: [
        {
          tests: [line],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
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
      spans: [
        {
          tests: [line],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
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

  it("the judge's suite-failed message reports the base run's result without claiming the span caused the failure", async () => {
    const line = "the widget refuses a negative count";
    // A test file the span never declared is red on the merged tree and green
    // at the base. One green base run is the whole evidence — a
    // load-sensitive failure reads exactly this way whichever span happened
    // to be merging — so the message states the two runs and stops.
    const { runner, asked } = fakeRunner(
      {
        passing: [{ fullName: `widget > ${line}`, file: "tests/widget.test.ts" }],
        failures: [INHERITED],
      },
      { passing: [{ fullName: INHERITED.name!, file: INHERITED.file }] },
    );

    const verdict = await judgeNamedLines(runner, {
      spans: [
        {
          tests: [line],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          footprint: FOOTPRINT,
        },
      ],
      cwd: CWD,
    });

    // Vacuity: the base run happened and came back green, so the message
    // below reports a run rather than reporting nothing.
    expect(asked.runAtBase).toHaveLength(1);
    expect(verdict.baseFailures).toEqual([]);
    expect(verdict.outcome).toBe("suite-failed");

    // The whole message, exactly: what ran on the merged tree, what came back
    // at the base, and no third clause drawing a cause from the two.
    expect(verdict.message).toBe(
      `the suite is not green: 1 failure(s), first ${INHERITED.file} \u00d7 ${INHERITED.name}` +
        `; the same 1 file(s) ran green at ${BASE_SHA.slice(0, 7)}`,
    );
    // Stated in the title's direction too, over a one-sentence message this
    // case composes end to end — not a rendered artifact quoting foreign
    // text, so the vocabulary is the assertion's own subject.
    expect(verdict.message).not.toMatch(/arrived with|caused/);
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
      spans: [
        {
          tests: [line],
          pins: [],
          laneTests: [],
          baseSha: BASE_SHA,
          // Both failing files are the span's own: the subject here is the blame
          // list's order, not what a base run would say about it.
          footprint: [...FOOTPRINT, "tests/zebra.test.ts", "tests/apple.test.ts"],
        },
      ],
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
        spans: [
          {
            tests: [line],
            pins: [],
            laneTests: [],
            baseSha: BASE_SHA,
            footprint: FOOTPRINT,
          },
        ],
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
const SITE: GateSite = {
  cwd: CWD,
  repoRoot: CWD,
  flumeDir: `${CWD}/.flume`,
  stateRootRel: ".flume",
  pendingDir: `${CWD}/.flume/plan/pending`,
  configDir: `${CWD}/.flume`,
  phaseName: "build",
  log: () => {},
};

const gateContext = (
  over: Pick<GateContext, "entry" | "touchedPaths">,
): GateContext => ({
  ...SITE,
  commitSha: "a".repeat(40),
  baseSha: BASE_SHA,
  landedOnSha: "b".repeat(40),
  ...over,
});

/** The entry a span was provisioned for, naming one behavior. */
const entryNaming = (line: string): PendingEntry => ({
  tag: "SOME-ENTRY",
  gate: { kind: "open" },
  dependsOnForks: [],
  kind: "work",
  files: { new: [], edit: [], retire: [] },
  tests: [line],
  pins: [],
});

describe("the named-lines gate", () => {
  const line = "the widget refuses a negative count";
  /**
   * A span that finished the entry it was handed — it wrote neither note
   * whose location puts the work down, so the judge rules
   * (`harness/chain.ts`).
   */
  const finished = (): undefined => undefined;
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

  it("the named-lines gate skips a span that wrote a continuing note", async () => {
    // The runner is the red-at-base one every case here uses: a gate that
    // ruled at all over it would refuse, so a green verdict below can only be
    // the skip.
    const runner = redBoth();
    const entry = entryNaming(line);
    const span = gateContext({ entry, touchedPaths: ["src/widget.ts"] });

    const result = await namedLinesGate(runner, () => "continuing").run(span);

    expect(result.ok).toBe(true);
    // Spelled as a skip rather than an unexplained green, and as the
    // continuation's own: the lines belong to the completed entry, and a
    // segment of it attempted them no more than a park did.
    expect(result.skipped).toBe(
      "the named lines belong to the completed entry, not to a segment of it",
    );
    expect(result.message).toBe(
      `${entry.tag}: continuing — a note under the continuing directory`,
    );

    // Non-vacuity, twice over. The same span with neither note written really
    // is judged — so the skip is the predicate's answer and not a gate stuck
    // on green...
    const judged = await namedLinesGate(redBoth(), finished).run(span);
    expect(judged.ok).toBe(false);
    expect(judged.skipped).toBeUndefined();
    // ...and a park over the same span skips too, under its own reason — so
    // the verdict above names the kind the tick declared rather than one
    // spelling covering both.
    const parked = await namedLinesGate(redBoth(), () => "parked").run(span);
    expect(parked.ok).toBe(true);
    expect(parked.skipped).toBe(
      "a park attempts none of the entry's named lines",
    );
    expect(parked.skipped).not.toBe(result.skipped);
  });

  it("a judge gate over an entry whose only named lines are laneTests passes with every line owed to its lane", async () => {
    const gated = "walls a worktree path only win32 refuses";
    const runner = fakeRunner({
      passing: [{ fullName: "worktrees > walls a path on every host", file: "tests/worktrees.test.ts" }],
      skipped: [`worktrees > ${gated}`],
    }).runner;
    const entry: PendingEntry = {
      ...entryNaming(line),
      tests: [],
      laneTests: [{ lane: "win32", title: gated }],
    };

    const result = await namedLinesGate(runner, finished).run(
      gateContext({ entry, touchedPaths: ["src/worktrees.ts"] }),
    );

    // Vacuity: the judge ruled. A put-down skip carries `skipped` and none of
    // the message below, so a green-over-nothing cannot read as this.
    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(true);
    // The line is named as owed, to its lane, on the surface the wave reads —
    // a pass whose one line was never green here says so.
    expect(result.message).toContain("1 laneTests[] line(s) owed to win32");

    // Non-vacuous the other way: the same entry with a title no case carries
    // refuses, so the pass above is the skipped case being read and not the
    // field going unparsed.
    const unnamed = await namedLinesGate(runner, finished).run(
      gateContext({
        entry: { ...entry, laneTests: [{ lane: "win32", title: "a case nobody wrote" }] },
        touchedPaths: ["src/worktrees.ts"],
      }),
    );
    expect(unnamed.ok).toBe(false);
    expect(unnamed.details?.split("\n")).toContain(
      `laneTests[] unnamed: "a case nobody wrote" (lane win32)`,
    );
  });

  it("the named-lines gate reports base-red as its verdict when the judge ruled the base red", async () => {
    const result = await namedLinesGate(redBoth(), finished).run(
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

  it("the named-lines gate declares blamesSpan false when the suite was already red at the base", async () => {
    const result = await namedLinesGate(redBoth(), finished).run(
      gateContext({ entry: entryNaming(line), touchedPaths: ["src/widget.ts"] }),
    );

    // Vacuity: the judge ran and refused. `blamesSpan` on a green or skipped
    // result would say nothing, so the arm under test is the refusing one.
    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe("base-red");

    // The declared fact the engine acts on: the failure predates the span,
    // so the retry is not quarantined for it.
    expect(result.blamesSpan).toBe(false);
  });

  it("a refusal the span is answerable for declares no blamesSpan", async () => {
    // Same runner, same entry; only the footprint differs, so the judge rules
    // the failing file the span's own. The disowning is the base-red arm's
    // alone — every other refusal stays blamed.
    const result = await namedLinesGate(redBoth(), finished).run(
      gateContext({
        entry: entryNaming(line),
        touchedPaths: ["src/widget.ts", inherited.file],
      }),
    );

    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.verdict).toBeUndefined();
    expect(result).not.toHaveProperty("blamesSpan");
  });

  it("hands the span's footprint to the judge, so a failing file the span touched carries no base-red", async () => {
    // The same runner and the same entry; only the span's touched paths
    // differ. Without the footprint reaching the judge, this would rule
    // base-red exactly as the case above does.
    const result = await namedLinesGate(redBoth(), finished).run(
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

/**
 * A second base for a batch whose spans branched from different tips — the
 * shape one base tree per span is the cost of.
 */
const OTHER_BASE = "9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d";

describe("the judge over a batch", () => {
  const first = "the widget refuses a negative count";
  const second = "the gauge rounds half up";
  const third = "the dial clamps at the ceiling";

  /** One span of a batch: its `tests[]`, and whichever facts a case varies. */
  const span = (
    tests: readonly string[],
    over?: { readonly baseSha?: string; readonly footprint?: readonly string[] },
  ): JudgeSpan => ({
    tests,
    pins: [],
    laneTests: [],
    baseSha: over?.baseSha ?? BASE_SHA,
    footprint: over?.footprint ?? FOOTPRINT,
  });

  /** A merged tree carrying one passing test per line, each in its own file. */
  const MERGED: FakeSuite = {
    passing: [
      { fullName: `widget > ${first}`, file: "tests/widget.test.ts" },
      { fullName: `gauge > ${second}`, file: "tests/gauge.test.ts" },
      { fullName: `dial > ${third}`, file: "tests/dial.test.ts" },
    ],
  };

  it("the judge runs the suite once over a batch's merged tree", async () => {
    const { runner, asked } = fakeRunner(MERGED, { passing: [] });

    const verdict = await judgeNamedLines(runner, {
      spans: [span([first]), span([second], { footprint: ["src/gauge.ts"] })],
      cwd: CWD,
    });

    // Vacuity: two spans, two lines, and both really were proven — so "once"
    // is a suite that covered the whole batch rather than one asked about
    // half of it.
    expect(verdict.outcome).toBe("proven");
    expect(verdict.lines.map((l) => l.state)).toEqual(["proven", "proven"]);

    // One run, asked about every span's line: the merged tree is the
    // consumer's whole suite whatever the merge carried.
    expect(asked.run).toHaveLength(1);
    expect(asked.run[0]?.names).toEqual([first, second]);
  });

  it("the judge builds one base tree per distinct base in a batch", async () => {
    const { runner, asked } = fakeRunner(MERGED, { passing: [] });

    await judgeNamedLines(runner, {
      spans: [
        span([first]),
        span([second], { footprint: ["src/gauge.ts"] }),
        span([third], { baseSha: OTHER_BASE, footprint: ["src/dial.ts"] }),
      ],
      cwd: CWD,
    });

    // Two bases among three spans, so two trees — and the shared one is asked
    // about both its spans' lines at once rather than once per span.
    expect(asked.runAtBase).toEqual([
      {
        names: [first, second],
        files: ["tests/widget.test.ts", "tests/gauge.test.ts"],
        baseSha: BASE_SHA,
        cwd: CWD,
      },
      { names: [third], files: ["tests/dial.test.ts"], baseSha: OTHER_BASE, cwd: CWD },
    ]);

    // Non-vacuous the other way: the same three spans sharing one base build
    // one tree, so the count above is the distinct bases and not the spans.
    const shared = fakeRunner(MERGED, { passing: [] });
    await judgeNamedLines(shared.runner, {
      spans: [
        span([first]),
        span([second], { footprint: ["src/gauge.ts"] }),
        span([third], { footprint: ["src/dial.ts"] }),
      ],
      cwd: CWD,
    });
    expect(shared.asked.runAtBase).toHaveLength(1);
  });

  it("each entry's named lines are proved red at that entry's own base", async () => {
    const spans = [
      span([first]),
      span([second], { baseSha: OTHER_BASE, footprint: ["src/gauge.ts"] }),
    ];
    const carried = (fullName: string, file: string): FakeSuite => ({
      passing: [{ fullName, file }],
    });
    // Each base carries its *sibling's* line and never its own span's: a
    // judge that asked the wrong tree would read both lines as already green
    // there, which is the whole difference one base per entry buys.
    const { runner, asked } = fakeRunner(MERGED, (baseSha) =>
      baseSha === BASE_SHA
        ? carried(`gauge > ${second}`, "tests/gauge.test.ts")
        : carried(`widget > ${first}`, "tests/widget.test.ts"),
    );

    const verdict = await judgeNamedLines(runner, { spans, cwd: CWD });

    // Vacuity: two trees were built, each asked about its own span's line.
    expect(asked.runAtBase.map((r) => [r.baseSha, r.names])).toEqual([
      [BASE_SHA, [first]],
      [OTHER_BASE, [second]],
    ]);
    expect(verdict.outcome).toBe("proven");
    expect(verdict.lines.map((l) => l.state)).toEqual(["proven", "proven"]);
    // Both bases are named, so a reader sees which tree each line was proved
    // against rather than one sha standing for the batch.
    expect(verdict.message).toContain(BASE_SHA.slice(0, 7));
    expect(verdict.message).toContain(OTHER_BASE.slice(0, 7));

    // Non-vacuous: each tree's answer really is read against the span that
    // branched from it. Hand every base its own span's line and both come
    // back already green there.
    const own = fakeRunner(MERGED, (baseSha) =>
      baseSha === BASE_SHA
        ? carried(`widget > ${first}`, "tests/widget.test.ts")
        : carried(`gauge > ${second}`, "tests/gauge.test.ts"),
    );
    const already = await judgeNamedLines(own.runner, { spans, cwd: CWD });
    expect(already.outcome).toBe("green-on-base");
    expect(
      already.lines.filter((l) => l.state === "green-on-base").map((l) => l.line),
    ).toEqual([first, second]);
  });

  it("a base tree is laid over the union of the files the entries' lines name", async () => {
    const { runner, asked } = fakeRunner(MERGED, { passing: [] });

    const verdict = await judgeNamedLines(runner, {
      spans: [span([first]), span([second], { footprint: ["src/gauge.ts"] })],
      cwd: CWD,
    });

    // Vacuity: each line really was carried in a file of its own on the
    // merged tree, so the union below is over two names and not one repeated.
    expect(verdict.lines.map((l) => l.files)).toEqual([
      ["tests/widget.test.ts"],
      ["tests/gauge.test.ts"],
    ]);

    // The spans share a base, so one tree is built — over both files, since a
    // tree missing one span's would read that span's line red for the wrong
    // reason.
    expect(asked.runAtBase).toEqual([
      {
        names: [first, second],
        files: ["tests/widget.test.ts", "tests/gauge.test.ts"],
        baseSha: BASE_SHA,
        cwd: CWD,
      },
    ]);
  });
});

describe("the named-lines gate over a batch", () => {
  const line = "the widget refuses a negative count";
  const other = "the gauge rounds half up";
  /** A span that finished the entry it was handed (`harness/putDown.ts`). */
  const finished = (): undefined => undefined;

  /** One span of a batched merge, as the dispatcher reports it. */
  const picked = (
    entry: PendingEntry,
    touchedPaths: readonly string[],
    baseSha = BASE_SHA,
  ): GateBatchSpan => ({
    entry,
    commitSha: "c".repeat(40),
    baseSha,
    landedOnSha: "b".repeat(40),
    touchedPaths,
  });

  it("the package's judge gate declares batches", () => {
    const { runner } = fakeRunner({ passing: [] });
    const gate = namedLinesGate(runner, finished);

    expect(gate.batches).toBe(true);
    // Vacuity: the declaration is only read off an `afterMerge` gate, so a
    // judge hung anywhere else would satisfy the assertion above and buy the
    // phase nothing.
    expect(gate.when).toBe("afterMerge");

    // And the engine reading it: a phase batches only where every one of its
    // `afterMerge` gates says it reads a batch, so this declaration is what
    // lets a batched merge reach the judge at all.
    const phase: Phase = {
      name: "build",
      description: "",
      promptPath: "prompt.md",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [gate],
      handoff: () => [],
    };
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { mergeBatch: 3 },
    };
    expect(mergeBatchWidth(chain, phase)).toBe(3);
  });

  it("the judge gate rules on every entry of a batch and leaves a parked span's lines unattempted", async () => {
    const { runner } = fakeRunner(
      {
        passing: [
          { fullName: `widget > ${line}`, file: "tests/widget.test.ts" },
          { fullName: `gauge > ${other}`, file: "tests/gauge.test.ts" },
        ],
      },
      { passing: [] },
    );
    const parked: PendingEntry = { ...entryNaming(other), tag: "PARKED-ENTRY" };
    const ctx = batchGateContext(SITE, [
      picked(entryNaming(line), ["src/widget.ts"]),
      picked(parked, [".flume/plan/notes/parked/PARKED-ENTRY.md"]),
    ]);

    const result = await namedLinesGate(runner, (entry) =>
      entry.tag === parked.tag ? "parked" : undefined,
    ).run(ctx);

    // The finished span's line is judged; the parked one's is not, and the
    // gate says which beside the ruling rather than passing over it.
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.message).toContain("1 tests[] line(s) green");
    expect(result.message).toContain(`${parked.tag}: parked`);

    // Non-vacuous: both lines were in the suite all along, and the same batch
    // with neither span putting its work down judges both.
    const judged = await namedLinesGate(runner, finished).run(ctx);
    expect(judged.ok).toBe(true);
    expect(judged.message).toContain("2 tests[] line(s) green");

    // And a batch whose every span put its work down skips exactly as a
    // single such span does, under the kind the spans declared.
    const down = await namedLinesGate(runner, () => "parked").run(ctx);
    expect(down.ok).toBe(true);
    expect(down.skipped).toBe("a park attempts none of the entry's named lines");
  });
});
