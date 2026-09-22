/**
 * Help-text and subcommand-table seam — split from tests/cli.test.ts along
 * the same seam as `src/cliHelp.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick").
 */

import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { EX_IOERR } from "../src/cli.ts";
import { EX_TERMINAL_MISCONFIG } from "../src/exitCodes.ts";
import { HELP_TOP, helpPageFor } from "../src/cliHelp.ts";
import {
  STATE_ROOT_NAMES,
  loopLockPath,
  mergingDir,
  stopFlagPath,
} from "../src/paths.ts";
import { renderPidClaim } from "../src/pidClaim.ts";
import {
  loopCompletionSummary,
  loopExitCode,
  tickExitCode,
} from "../src/cliVerdict.ts";
import {
  DEFAULT_ABORT_THRESHOLD,
  FAILURE_STAGES,
} from "../src/loopSupervisor.ts";
import type { SuperviseResult } from "../src/loopSupervisor.ts";
import type { TickOutcome } from "../src/Dispatcher.ts";
import {
  tickVerdictsLogPath,
  type TickVerdict,
} from "../src/tickVerdict.ts";
import type { TickResult } from "../src/Phase.ts";
import {
  documentedExitCodeRows,
  documentedExitCodes,
} from "./helpers/cliHelpRows.ts";
import { denyDirectory, denyFile } from "./helpers/denial.ts";
import { minimalChainSrc, writeRepoConfig } from "./helpers/repoChain.ts";
import { sectionOf } from "./helpers/docSections.ts";
import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import { makeScratchRepo } from "./helpers/scratchRepo.ts";
import {
  SPAWN_BUDGET_MS,
  runCli,
  runCliStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const ascending = (codes: Iterable<number>): number[] =>
  [...new Set(codes)].sort((a, b) => a - b);

/** One well-formed history row, for the `log` refusal case's non-vacuity arm. */
function logVerdict(): TickVerdict {
  return {
    phaseName: "help-probe",
    tags: [],
    committed: false,
    gateResults: [],
    shippedTags: [],
    mergeOutcomes: [],
    invocations: [],
    summary: "help-probe: one tick",
    headSha: "0".repeat(40),
    at: "2024-01-01T00:00:00.000Z",
  };
}

/**
 * The command names the top-level listing's own `Commands:` block
 * advertises — read off `HELP_TOP` rather than restated, so the two cases
 * below judge the block the CLI really prints.
 */
function topLevelCommandNames(): string[] {
  const start = HELP_TOP.indexOf("Commands:\n");
  expect(start).toBeGreaterThan(-1);
  const block = HELP_TOP.slice(start, HELP_TOP.indexOf("\n\nOptions:"));
  return [
    ...new Set(
      block
        .split("\n")
        .map((line) => /^ {2}(\S+)/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  ];
}

/**
 * The engine offers no lifecycle verb over a job — it mints no state root
 * beneath the checkout and seeds none (spec/jobs.md, *The checkout is the
 * unit of isolation*). `job` is therefore an ordinary unrecognized word, and
 * the CLI owes it the same refusal every other unrecognized word gets rather
 * than a verb-shaped usage line that reads as a typo inside a real command.
 *
 * Driven through the real CLI: the arm under test is the dispatch, and a
 * control word beside it keeps the refusal `job`'s own rather than the
 * fixture's (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
it("flume job is an unknown command and exits 2", async () => {
  const dir = await mkFixtureRoot("flume-job-unknown-");
  try {
    // Control: a word the CLI does answer, so the refusal below is not the
    // fixture refusing everything.
    const known = await runCli(dir, ["status"]);
    expect(known.code).toBe(0);

    for (const argv of [["job"], ["job", "status"], ["job", "new", "x"]]) {
      const r = await runCli(dir, argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.out, argv.join(" ")).toContain("unknown command: job");
      expect(r.out, argv.join(" ")).toContain("Run `flume --help` for usage.");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, SPAWN_BUDGET_MS);

/**
 * The same absence on the surface an operator reads to find the verb set:
 * the listing must not advertise a verb the dispatch refuses. Scoped to the
 * `Commands:` block alone, which is the listing the claim is about — a
 * negative read of the whole rendered page would turn on whatever else it
 * happens to quote (`.claude/rules/posture-sweep.md`, *A violation counts
 * only when verified on disk this tick*).
 */
it("the top-level help names no job verb", () => {
  const names = topLevelCommandNames();
  // Vacuity: an unparsed block would hold this over the empty set.
  expect(names.length).toBeGreaterThan(1);
  expect(names).toContain("loop");
  expect(names).not.toContain("job");
  expect(helpPageFor("job")).toBeUndefined();
});

/*
 * The `flume tick` process's exit-code range, in two halves with different
 * owners, driven rather than hand-copied so every surface that restates it
 * below compares against a real producer (`.claude/rules/engineering.md`,
 * "A seam gate reads what the real writer wrote"): the codes `tickExitCode`
 * (`src/cliVerdict.ts`) maps a `TickOutcome` to, and the codes the process
 * returns without ever reaching that function. Both `flume tick --help` and
 * `docs/CLI.md` § `flume tick` restate this range; each is pinned against
 * the producer below, never against the other copy.
 */

/**
 * Exit codes the `flume tick` process returns that `tickExitCode` cannot:
 * cli.ts's own refusals, taken before a dispatcher outcome exists (the
 * detached-HEAD refusal, the held-tip-claim refusal) or in place of one
 * (main's harness-error exit). Named rather than derived — each is a
 * `return`/`process.exit` literal on a control path with no outcome value
 * to drive.
 */
const TICK_PROCESS_LEVEL_EXIT_CODES = new Map<number, string>([
  [1, "detached HEAD or held tip claim refusal, or a harness error"],
  [
    74,
    "the state root at bay discovery, or the verdict history the tick " +
      "records into, is present and unreadable",
  ],
]);

/*
 * The `flume loop` process's exit-code range, in the same two halves: the
 * codes `loopExitCode` (`src/cliVerdict.ts`) maps a `SuperviseResult` to,
 * and the codes the process returns without ever reaching it. `docs/CLI.md`
 * § `flume loop` and `flume loop --help` each restate this range, and each
 * is pinned against the producer below rather than against the other copy —
 * two prose copies compared to each other move together in the commit that
 * changes the behavior, and agree while both are wrong.
 */

/**
 * Exit codes the `flume loop` process returns that `loopExitCode` cannot:
 * cli.ts's start-up refusals, taken before any tick runs and so before a
 * `SuperviseResult` exists. 1 and 78 are *not* here — the run reaches both
 * through the supervised result as well, so the driven half already owns
 * them.
 */
const LOOP_PROCESS_LEVEL_EXIT_CODES = new Map<number, string>([
  [2, "a bad --max value, or a stray positional past --max <value>"],
  [
    74,
    "the stop flag, the loop lock, or the merging-marker dir exists but " +
      "could not be read",
  ],
]);

/** Candidate standing for "this field is not set on the outcome". */
const ABSENT = Symbol("absent");

const A_TICK_RESULT: TickResult = {
  phaseName: "plan",
  committed: true,
  gateResults: [],
  pendingAfter: [],
  pickableAfter: [],
  shippedTags: [],
  revertedTags: [],
  flumeDir: ".flume",
  configDir: ".flume",
};

const A_TICK_VERDICT: TickVerdict = {
  phaseName: "plan",
  tags: [],
  committed: true,
  gateResults: [],
  shippedTags: [],
  mergeOutcomes: [],
  invocations: [],
  summary: "plan committed 0000000",
  headSha: "0".repeat(40),
  at: "2026-01-01T00:00:00.000Z",
};

const A_STAGE_FAILURE = { signature: "boom", message: "boom" };

/**
 * One candidate list per `TickOutcome` field, keyed with the optionality
 * stripped so a field added to the outcome is a compile error here — the
 * point at which someone supplies its candidates. Every field carries a
 * present value as well as `ABSENT`, because a branch `tickExitCode` grows
 * on a field it ignores today is exactly the change this gate exists to
 * catch; a field left absent everywhere would let that branch ship green.
 * The values themselves are representative, not exhaustive: what varies
 * per field is presence, and per boolean, which of the two it holds.
 */
const TICK_OUTCOME_SPACE: {
  [K in keyof TickOutcome]-?: readonly (TickOutcome[K] | typeof ABSENT)[];
} = {
  hibernated: [false, true],
  failed: [ABSENT, false, true],
  usageError: [ABSENT, false, true],
  tipMoved: [ABSENT, false, true],
  declined: [ABSENT, false, true],
  terminal: [ABSENT, { kind: "orphaned-awake", phases: ["ghost"] }],
  phaseName: [ABSENT, "plan"],
  result: [ABSENT, A_TICK_RESULT],
  noCommit: [ABSENT, "clean-exit"],
  provisionFailures: [ABSENT, [A_STAGE_FAILURE]],
  mergeFailures: [ABSENT, [A_STAGE_FAILURE]],
  gateFailures: [ABSENT, [A_STAGE_FAILURE]],
  verdict: [ABSENT, A_TICK_VERDICT],
  awakeAfter: [[], ["plan"]],
  summary: ["no phases awake; hibernating"],
};

/**
 * One candidate list per `SuperviseResult` field, under the same discipline
 * as {@link TICK_OUTCOME_SPACE} above: optionality stripped so a field
 * added to the result is a compile error here, every optional field
 * carrying `ABSENT` beside a present value so a branch `loopExitCode` grows
 * on a field it ignores today cannot ship green, and representative values
 * per field rather than exhaustive ones.
 */
const SUPERVISE_RESULT_SPACE: {
  [K in keyof SuperviseResult]-?: readonly (SuperviseResult[K] | typeof ABSENT)[];
} = {
  ticks: [0, 3],
  hibernated: [false, true],
  terminal: [ABSENT, { kind: "orphaned-awake", phases: ["ghost"] }],
  mountDead: [ABSENT, false, true],
  shippedTags: [[], ["SHIPPED-ONE"]],
  erroredTicks: [[], ["tick 1: gate-revert"]],
  agentUsageByPhase: [
    [],
    [
      {
        phase: "build",
        invocations: 1,
        turns: 4,
        durationMs: 1000,
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 40,
        costUsd: 0.5,
      },
    ],
  ],
  repeatedFailure: [
    ABSENT,
    { stage: "provision", signature: "boom", count: 3 },
    { stage: "gate", signature: "boom", count: 3 },
  ],
  stoppedByFlag: [ABSENT, false, true],
};

/**
 * Every value the candidate table spans, `ABSENT` fields left unset. A
 * generator, not an array: a product runs to tens of thousands of values,
 * and only the code each one maps to is worth keeping. Generic over the
 * table's type — the space mechanics are the same whichever verdict
 * function is being driven, so both drivers below share this one
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 */
function* candidateSpace<T>(
  fields: readonly (readonly [string, readonly unknown[]])[],
  partial: Record<string, unknown> = {},
): Generator<T> {
  const [head, ...rest] = fields;
  if (!head) {
    yield partial as unknown as T;
    return;
  }
  const [field, candidates] = head;
  for (const value of candidates) {
    yield* candidateSpace<T>(
      rest,
      value === ABSENT ? partial : { ...partial, [field]: value },
    );
  }
}

/**
 * Drive a real exit-code function over its candidate table and return the
 * codes it produced, with the size of the space it was driven over so each
 * caller can pin its own non-vacuity: a space that collapsed, or a range
 * that did, agrees with almost any prose.
 */
function driveExitCodes<T>(
  space: object,
  classify: (value: T) => number,
): { returned: Set<number>; spanned: number } {
  const returned = new Set<number>();
  let spanned = 0;
  for (const value of candidateSpace<T>(
    Object.entries(space) as [string, readonly unknown[]][],
  )) {
    spanned++;
    returned.add(classify(value));
  }
  return { returned, spanned };
}

const driveTickExitCodes = (): { returned: Set<number>; spanned: number } =>
  driveExitCodes<TickOutcome>(TICK_OUTCOME_SPACE, tickExitCode);

const driveLoopExitCodes = (): { returned: Set<number>; spanned: number } =>
  driveExitCodes<SuperviseResult>(SUPERVISE_RESULT_SPACE, loopExitCode);

/**
 * The whole range a surface owes an operator: what the driven function
 * returns, plus the process-level codes it cannot.
 */
function wholeRange(
  returned: Iterable<number>,
  processLevel: ReadonlyMap<number, string>,
): number[] {
  return ascending([...returned, ...processLevel.keys()]);
}

/**
 * The named process-level half holds only what the driven function *cannot*
 * return. The defect this discipline carried was a process-level code read
 * as part of a function's range, which let a real range change ship green.
 */
function expectProcessLevelDisjoint(
  returned: ReadonlySet<number>,
  processLevel: ReadonlyMap<number, string>,
  fn: string,
): void {
  expect(processLevel.size).toBeGreaterThan(0);
  for (const [exitCode, site] of processLevel) {
    expect(
      returned.has(exitCode),
      `${exitCode} (${site}) is in ${fn}'s own range`,
    ).toBe(false);
  }
}

/**
 * CLI-HELP-TICK-MISSING-EXIT2 — `flume tick --help`'s exit-code list is the
 * prose copy of the two halves above. Neither is hand-copied: the first is
 * derived by driving the real function over the outcome space, the second
 * is the named process-level set, asserted to hold nothing `tickExitCode`
 * can return. A code added to or dropped from either side turns this red
 * instead of shipping one-sided (`.claude/rules/engineering.md`, "A seam
 * gate reads what the real writer wrote").
 */
describe("flume tick --help — the exit-code list against tickExitCode's derived range (CLI-HELP-TICK-MISSING-EXIT2)", () => {
  it("flume tick --help documents every exit code tickExitCode returns, beside a named process-level set", async () => {
    const { returned, spanned } = driveTickExitCodes();
    // Non-vacuity: an outcome space that collapsed, or a range that did,
    // would agree with almost any help text.
    expect(spanned).toBeGreaterThan(1);
    expect(returned.size).toBeGreaterThan(1);

    expectProcessLevelDisjoint(
      returned,
      TICK_PROCESS_LEVEL_EXIT_CODES,
      "tickExitCode",
    );

    const { out, code } = await runCli(process.cwd(), ["tick", "--help"]);
    expect(code).toBe(0);
    expect(ascending(documentedExitCodes(out))).toEqual(
      wholeRange(returned, TICK_PROCESS_LEVEL_EXIT_CODES),
    );
  }, SPAWN_BUDGET_MS);
});

/**
 * Every backticked bare integer a `docs/CLI.md` section carries, code or
 * not — the denominator {@link namedExitCodes} reads its codes out of.
 */
function backtickedIntegers(section: string): number[] {
  const values = new Set<number>();
  for (const [, value] of section.matchAll(/`(\d+)`/g)) {
    values.add(Number(value));
  }
  return ascending(values);
}

/**
 * How a `docs/CLI.md` section names an exit code: a backticked bare integer
 * introduced by the word "exit" — "exits `69`", "refuses (exit `1`)", "Exit
 * code stays `0`" — and that context is what makes a read of it a claim about
 * the verb's range rather than about any number the prose happens to
 * backtick. These sections also backtick integers that are values (`--max`'s
 * default), and a value read as a code would put the page permanently at odds
 * with every producer. The window between the word and the code admits no
 * backtick, so the two must sit in one clause.
 *
 * One home for the two reads below — the whole range a section names, and the
 * sentences it spends on one code (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*). `matchAll` works over a clone, so this global
 * pattern carries no match position between calls.
 */
const NAMED_EXIT_CODE = /\bexits?\b[^`\n]{0,24}`(\d+)`/gi;

/** The exit codes a `docs/CLI.md` section names, read by the rule above. */
function namedExitCodes(section: string): number[] {
  const codes = new Set<number>();
  for (const [, code] of section.matchAll(NAMED_EXIT_CODE)) {
    codes.add(Number(code));
  }
  return ascending(codes);
}

/**
 * The sentences of a `docs/CLI.md` section that name one exit code — the
 * window a claim about *that* code's causes is read from.
 *
 * Scoped rather than section-wide on purpose: a section documents a verb's
 * whole range, so a set read off all of it turns on whatever the neighbouring
 * arms happen to quote rather than on the arm the case is about
 * (`.claude/rules/posture-sweep.md`, *A violation counts only when verified
 * on disk this tick*). A sentence ends at a period followed by the opening of
 * the next — the page's own arms are one sentence each, semicolons and
 * em-dashes included.
 */
function sentencesNamingExitCode(section: string, code: number): string[] {
  return section
    .split(/(?<=\.)\s+(?=[A-Z`(])/)
    .filter((sentence) =>
      [...sentence.matchAll(NAMED_EXIT_CODE)].some(
        ([, named]) => Number(named) === code,
      ),
    );
}

/** `docs/CLI.md` as the working tree holds it. */
async function readCliDoc(): Promise<string> {
  return readFile(
    fileURLToPath(new URL("../docs/CLI.md", import.meta.url)),
    "utf8",
  );
}

/**
 * CLI-DOC-TICK-EXIT-CODES-PINNED — `docs/CLI.md` § `flume tick` is a second
 * prose copy of the same range, and it had drifted: it named 0, 69 and 1
 * and neither the usage code nor the terminal-misconfiguration code the
 * verb really returns. It is pinned against the same driven producer as the
 * help text above rather than against the help text itself — two prose
 * copies compared to each other move together in the commit that changes
 * the behavior, and agree while both are wrong
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("docs/CLI.md's flume tick section against tickExitCode's derived range (CLI-DOC-TICK-EXIT-CODES-PINNED)", () => {
  it("docs/CLI.md's flume tick section names every exit code the real tick range produces", async () => {
    const { returned, spanned } = driveTickExitCodes();
    // Non-vacuity, as above: a collapsed space or range agrees with prose
    // that names almost anything.
    expect(spanned).toBeGreaterThan(1);
    expect(returned.size).toBeGreaterThan(1);
    expectProcessLevelDisjoint(
      returned,
      TICK_PROCESS_LEVEL_EXIT_CODES,
      "tickExitCode",
    );

    const section = sectionOf(await readCliDoc(), "## `flume tick`");
    expect(section.length).toBeGreaterThan(0);

    // Exactly the range, in both directions: a code the verb gained and the
    // page never named is red, and so is a code the page names that the
    // producer can no longer return.
    expect(namedExitCodes(section)).toEqual(
      wholeRange(returned, TICK_PROCESS_LEVEL_EXIT_CODES),
    );
  });
});

/**
 * CLI-DOC-LOOP-EXIT-CODES-PINNED — `docs/CLI.md` § `flume loop` is the loop
 * range's prose copy, and it had drifted: it named 0, 1 and 69 and neither
 * the usage code, the I/O refusal nor the terminal-misconfiguration code. It
 * is pinned against the driven producer — `loopExitCode` over the
 * `SuperviseResult` space, beside the named start-up set — never against the
 * `--help` block (`.claude/rules/engineering.md`, "A seam gate reads what
 * the real writer wrote").
 */
describe("docs/CLI.md's loop sections against loopExitCode's derived range (CLI-DOC-LOOP-EXIT-CODES-PINNED)", () => {
  /**
   * Both sections make the same claim about the same range, so both take
   * the same check: exactly the range, in both directions, plus the reader
   * discrimination that claim rests on.
   */
  async function expectSectionNamesTheLoopRange(heading: RegExp): Promise<void> {
    const { returned, spanned } = driveLoopExitCodes();
    // Non-vacuity: a collapsed result space, or a range that collapsed,
    // agrees with prose that names almost anything.
    expect(spanned).toBeGreaterThan(1);
    expect(returned.size).toBeGreaterThan(1);
    expectProcessLevelDisjoint(
      returned,
      LOOP_PROCESS_LEVEL_EXIT_CODES,
      "loopExitCode",
    );

    const section = sectionOf(await readCliDoc(), heading);
    expect(section.length).toBeGreaterThan(0);

    const named = namedExitCodes(section);
    expect(named).toEqual(wholeRange(returned, LOOP_PROCESS_LEVEL_EXIT_CODES));
    // The reader discriminates rather than sweeping up every backticked
    // integer: each of these sections also documents `--max`'s default,
    // which is a value and not a code. A reader that read it as one would
    // hold the page permanently at odds with the producer above, so the
    // section is asserted to carry at least one backticked integer that
    // survived as a non-code.
    expect(backtickedIntegers(section).length).toBeGreaterThan(named.length);
  }

  it("docs/CLI.md's flume loop section names every exit code the real loop range produces", async () => {
    await expectSectionNamesTheLoopRange(/^## `flume loop\b/);
  });

});

/**
 * CLI-DOC-STATUS-LOG-EXIT-CODES-PINNED — `docs/CLI.md` § `flume status` and
 * § `flume log` are the two prose copies of a verb's exit-code range this
 * page carried with nothing reading them against the verb.
 *
 * Neither verb has a `tickExitCode`-shaped classifier to drive over a
 * candidate space: both decide their code inside `main`'s own control flow,
 * from what they found on disk. So the producer here is the **process** —
 * one real `flume status` / `flume log` run per arm the section claims,
 * against a fixture built to reach that arm — and the section is compared to
 * the set those runs returned, never to the verb's `--help` block, which is
 * the other prose copy and moves with the page (`.claude/rules/engineering.md`,
 * "A seam gate reads what the real writer wrote").
 *
 * The bound this producer carries, declared rather than left implicit: a
 * driven arm proves the code it returns is a code the verb returns, so the
 * "page names nothing the verb cannot do" direction is exact, while the
 * converse reaches exactly the arms {@link DrivenRun} lists. A code reached
 * by an arm nobody wrote is invisible here, the same bound the named
 * process-level halves above carry.
 */

/**
 * One real run of a verb, made for the code it returns: the invocation, the
 * fixture mutation it needs, and the evidence the run's own output carries
 * iff it reached the arm that code is about.
 */
interface DrivenRun {
  /** The arm, named for a failure message. */
  readonly arm: string;
  /** A substring the run prints iff it got there. */
  readonly evidence: string;
  /** The invocation, with whatever fixture setup arms it. */
  readonly run: () => Promise<{ out: string; code: number }>;
}

/**
 * Drive a verb's arms in order and return the codes they produced, ascending.
 *
 * Each arm pins its own non-vacuity: a fixture that never reached the arm —
 * a chain that died first, a refusal taken ahead of the read — exits some
 * plausible code and would agree with prose naming almost anything, so the
 * run's output is asserted to carry the arm's evidence before its code
 * counts (`.claude/rules/engineering.md`, "A green verdict is proven
 * non-vacuous"). The code is folded in either way, so an arm that reached
 * its subject and returned something else reds on the equality rather than
 * being dropped.
 */
async function driveRunExitCodes(
  arms: readonly DrivenRun[],
): Promise<number[]> {
  // Vacuity: a table that collapsed to one arm agrees with a section naming
  // one code, whichever code that is.
  expect(arms.length).toBeGreaterThan(1);
  const returned = new Set<number>();
  for (const { arm, evidence, run } of arms) {
    const { out, code } = await run();
    expect(out, arm).toContain(evidence);
    returned.add(code);
  }
  return ascending(returned);
}

/**
 * A verdict row carrying one agent invocation, dated `at` — what `status`'s
 * spend line needs to print at all. A phase that invoked no agent is absent
 * from that listing rather than listed at zero, so a row with no invocations
 * would leave the line silent and the refusal beneath it unreached.
 */
function spendVerdict(at: Date): TickVerdict {
  return {
    ...logVerdict(),
    phaseName: "spend-probe",
    invocations: [
      {
        promptPath: "prompts/spend-probe.md",
        uncommittedTracked: [],
        turns: 4,
        durationMs: 1000,
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.5,
      },
    ],
    at: at.toISOString(),
  };
}

describe("docs/CLI.md's status and log sections against the codes those verbs really return (CLI-DOC-STATUS-LOG-EXIT-CODES-PINNED)", () => {
  it("docs/CLI.md's flume status section names every exit code the real status verb returns", async () => {
    const root = await mkFixtureRoot("flume-doc-status-exits-");
    const flumeDir = join(root, ".flume");
    // The window the spend line totals over: the lock states when the run
    // took it, and a row dated inside that window is the run's own.
    const startedAt = new Date();
    try {
      const driven = await driveRunExitCodes([
        {
          arm: "an ordinary observation",
          evidence: "pending: 0",
          run: () => runCli(root, ["status"]),
        },
        {
          // The spend line's own arm, and the non-vacuity for the refusal
          // below: this run reads the very file that one denies.
          arm: "the live run's agent spend",
          evidence: "agent usage this run",
          run: async () => {
            // The lock is composed by the real writer of that statement
            // (`renderPidClaim`, `src/pidClaim.ts`), never hand-spelled here
            // — a hand copy would re-author the claim format by the tester's
            // hand and agree with a reader that had changed.
            await writeFile(
              loopLockPath(flumeDir),
              renderPidClaim(process.pid, startedAt),
              "utf8",
            );
            const spent = spendVerdict(new Date(startedAt.getTime() + 1000));
            await writeFile(
              tickVerdictsLogPath(flumeDir),
              JSON.stringify(spent) + "\n",
              "utf8",
            );
            return runCli(root, ["status"]);
          },
        },
        {
          arm: "a tick-verdicts.jsonl the live run's spend line cannot read",
          evidence: "tick-verdicts.jsonl failed to read",
          run: () => {
            denyFile(tickVerdictsLogPath(flumeDir));
            return runCli(root, ["status"]);
          },
        },
      ]);

      const section = sectionOf(await readCliDoc(), /^## `flume status\b/);
      expect(section.length).toBeGreaterThan(0);
      // Exactly the driven set, in both directions: a code the verb gained
      // and the page never named is red, and so is a code the page names
      // that no arm can produce.
      expect(namedExitCodes(section)).toEqual(driven);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("docs/CLI.md's flume log section names every exit code the real log verb returns", async () => {
    const root = await mkFixtureRoot("flume-doc-log-exits-");
    const flumeDir = join(root, ".flume");
    try {
      const driven = await driveRunExitCodes([
        {
          arm: "a history it printed",
          evidence: "help-probe",
          run: async () => {
            await writeFile(
              tickVerdictsLogPath(flumeDir),
              JSON.stringify(logVerdict()) + "\n",
              "utf8",
            );
            return runCli(root, ["log"]);
          },
        },
        {
          arm: "-n missing its value",
          evidence: "usage: flume log",
          run: () => runCli(root, ["log", "-n"]),
        },
        {
          arm: "a tick-verdicts.jsonl that cannot be read",
          evidence: "tick-verdicts.jsonl failed to read",
          run: () => {
            denyFile(tickVerdictsLogPath(flumeDir));
            return runCli(root, ["log"]);
          },
        },
      ]);

      const section = sectionOf(await readCliDoc(), /^## `flume log\b/);
      expect(section.length).toBeGreaterThan(0);
      const named = namedExitCodes(section);
      expect(named).toEqual(driven);
      // The reader discriminates rather than sweeping up every backticked
      // integer: this section also documents `-n`'s default, which is a
      // value and not a code. A reader that read it as one would hold the
      // page permanently at odds with the runs above, so the section is
      // asserted to carry at least one backticked integer that survived as
      // a non-code.
      expect(backtickedIntegers(section).length).toBeGreaterThan(named.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * JOB-HELP-NAMES-THE-WHOLE-LOOP-RANGE — the loop range's *runtime* prose
 * copy. `flume loop --help`'s block owes exactly the loop range — and it
 * named 0, 1, 2 and 78 alone: an operator hitting a child tick's mount-dead
 * (69) or a start-up I/O refusal (74) read a status the surface never
 * mentioned. The block is driven against `loopExitCode` beside the named
 * start-up set, never against `docs/CLI.md` — two prose copies compared to
 * each other move together in the commit that changes the behavior, and
 * agree while both are wrong (`.claude/rules/engineering.md`, "A seam gate
 * reads what the real writer wrote").
 */
describe("the --help block that restates the loop range, against loopExitCode's derived range (JOB-HELP-NAMES-THE-WHOLE-LOOP-RANGE)", () => {
  /**
   * The block's own listed codes, read off the real help output, equal to
   * the whole range in both directions — a code the run gained and the
   * block never named is red, and so is a code the block names that no
   * longer reaches an operator through it.
   */
  async function expectHelpNamesTheLoopRange(
    argv: readonly string[],
  ): Promise<void> {
    const { returned, spanned } = driveLoopExitCodes();
    // Non-vacuity: a collapsed result space, or a range that collapsed,
    // agrees with a help block that lists almost anything.
    expect(spanned).toBeGreaterThan(1);
    expect(returned.size).toBeGreaterThan(1);
    expectProcessLevelDisjoint(
      returned,
      LOOP_PROCESS_LEVEL_EXIT_CODES,
      "loopExitCode",
    );

    const { out, code } = await runCli(process.cwd(), [...argv]);
    expect(code).toBe(0);
    const documented = ascending(documentedExitCodes(out));
    expect(documented.length).toBeGreaterThan(0);
    expect(documented).toEqual(
      wholeRange(returned, LOOP_PROCESS_LEVEL_EXIT_CODES),
    );
  }

  it("flume loop --help names every exit code the loop range produces, beside its named start-up set", async () => {
    await expectHelpNamesTheLoopRange(["loop", "--help"]);
  }, SPAWN_BUDGET_MS);
});

/*
 * LOOP-74-CAUSE-LIST-PINNED-PER-ARM — the loop range's 74 row is a *cause
 * list*, and a range pin cannot see it: the two pins above compare code sets,
 * so both stay green while a row that names 74 forgets one of the three
 * artifacts an operator can hit it on. The row itself, and the same list in
 * `docs/CLI.md`, are pinned here against the real refusals — each of loop's
 * three start-up I/O arms driven for real, one run apiece, and the artifact
 * each one reports taken off the engine's own name for it
 * (`STATE_ROOT_NAMES`, `src/paths.ts`) rather than spelled again by the
 * tester's hand (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 *
 * The bound, declared rather than left implicit: an arm nobody wrote is
 * invisible here, exactly as it is for the driven status/log ranges above, and
 * the "and no others" direction reaches the engine's own artifact vocabulary —
 * a cause the page names that is no state-root artifact at all is out of this
 * pin's sight.
 */

/**
 * The state-root artifacts the engine has names for. The "no others"
 * direction is read against this vocabulary, so it comes off the engine's own
 * table rather than a list of the three arms' names restated as their own
 * complement.
 */
const STATE_ROOT_ARTIFACTS: readonly string[] = Object.values(STATE_ROOT_NAMES);

/**
 * The state-root artifacts a passage of prose names. A page names one as a
 * backticked path — `` `.flume/stop` ``, `` `loop.pid` ``, `` `.flume/merging/` ``
 * — so the read takes the last segment of every backticked token and keeps
 * whatever the engine has a name for. A bare word is never read: "the stop
 * flag" and "a graceful stop" are prose about an artifact, and a passage that
 * merely mentions one is not the passage that documents it.
 */
function artifactsNamedIn(prose: string): string[] {
  const named = new Set<string>();
  for (const [, token] of prose.matchAll(/`([^`\n]+)`/g)) {
    // The separator here is markdown's, never the host's: these are paths the
    // page spells, not paths this process composed.
    const segment = token?.replace(/\/+$/, "").split("/").at(-1);
    if (segment !== undefined && STATE_ROOT_ARTIFACTS.includes(segment)) {
      named.add(segment);
    }
  }
  return [...named].sort();
}

/**
 * One start-up I/O refusal `flume loop` takes before any tick runs: the
 * engine's own name for the artifact it reports, the engine's own accessor for
 * that artifact's path, what the refusal says it could not do, and the denial
 * that makes the read fail for a reason other than absence.
 */
interface StartupIoRefusal {
  /** The reported artifact, off `STATE_ROOT_NAMES`. */
  readonly artifact: string;
  readonly path: (flumeDir: string) => string;
  /** The refusal's own verb — what it could not do to the artifact. */
  readonly failed: string;
  readonly deny: (path: string) => Promise<void> | void;
}

/**
 * Every arm of `flume loop`'s start-up 74, in the order the run reaches them
 * — the stop-flag probe, the lock's liveness read, the merging-marker listing.
 * Each is driven by {@link driveStartupIoRefusals} below; a fourth arm added
 * to the run and not here is the bound this pin declares, not a silent pass.
 */
const LOOP_STARTUP_IO_REFUSALS: readonly StartupIoRefusal[] = [
  {
    artifact: STATE_ROOT_NAMES.stopFlag,
    path: stopFlagPath,
    failed: "failed to stat",
    // A self-referential symlink, as `tests/cli.test.ts` arms this same arm:
    // ELOOP is the non-ENOENT stat failure, and a structural denial
    // (`tests/helpers/denial.ts`) cannot reach it — a directory at the path
    // stats clean and reads as a flag that *is* present, which is the exit-1
    // arm and not this one.
    deny: (path) => symlink(path, path),
  },
  {
    artifact: STATE_ROOT_NAMES.loopLock,
    path: loopLockPath,
    failed: "failed to read",
    deny: denyFile,
  },
  {
    artifact: STATE_ROOT_NAMES.merging,
    path: mergingDir,
    failed: "failed to list",
    deny: denyDirectory,
  },
];

/**
 * Drive every arm above for real, one `flume loop` run each over one scratch
 * repository, and return the artifacts those refusals reported.
 *
 * A real repository on a named branch, because two of the three arms sit past
 * refusals that need one: the lock read is past the detached-HEAD refusal, and
 * the marker listing is past the tip claim.
 *
 * Each arm pins its own non-vacuity: a run that never reached the read — a
 * refusal taken ahead of it, a denial armed at the wrong path — exits some
 * plausible code and would agree with prose naming almost anything, so the
 * run's own output is asserted to name the artifact and the read it failed at
 * before that artifact counts (`.claude/rules/engineering.md`, *A green
 * verdict is proven non-vacuous*).
 */
async function driveStartupIoRefusals(): Promise<string[]> {
  const repo = await makeScratchRepo("flume-loop-74-arms-", "main");
  const flumeDir = join(repo.dir, ".flume");
  try {
    const reported = new Set<string>();
    for (const refusal of LOOP_STARTUP_IO_REFUSALS) {
      const path = refusal.path(flumeDir);
      await refusal.deny(path);

      const { out, code } = await runCli(repo.dir, ["loop", "--max", "0"]);

      expect(code, refusal.artifact).toBe(EX_IOERR);
      // The artifact, by the engine's own name for it, and the read it
      // failed at. The name rather than the path: all three refusals state
      // the path they resolved, and the name is the last segment of each, so
      // the name is what all three report however the root is placed.
      expect(out, refusal.artifact).toContain(refusal.artifact);
      expect(out, refusal.artifact).toContain(refusal.failed);
      // And the refusal was taken instead of a run, not beside one.
      expect(out, refusal.artifact).not.toContain("reached --max");
      reported.add(refusal.artifact);

      // This arm's denial comes off the disk before the next is armed: the
      // arms are ordered as the run reaches them, so one left standing
      // refuses again and the arm behind it is never reached.
      await rm(path, { recursive: true, force: true });
    }
    // Vacuity: one arm that happened to fire agrees with a row naming one
    // artifact, whichever it is.
    expect(reported.size).toBe(LOOP_STARTUP_IO_REFUSALS.length);
    expect(reported.size).toBeGreaterThan(1);
    return [...reported].sort();
  } finally {
    await repo.cleanup();
  }
}

describe("the loop 74 row's cause list, against the start-up refusals that really report one (LOOP-74-CAUSE-LIST-PINNED-PER-ARM)", () => {
  /**
   * The driven artifacts, produced once for the suite: three real `flume loop`
   * runs against one scratch repository, which rides the hook's budget rather
   * than making either case below a four-spawn test (spec/worktrees.md, *The
   * default test lane must stay fast*).
   */
  let reported: string[];
  beforeAll(async () => {
    reported = await driveStartupIoRefusals();
  }, SPAWN_BUDGET_MS);

  /**
   * The vocabulary the "and no others" direction is read against is wider
   * than the arms, in both cases below: an artifact the engine names and no
   * start-up refusal reports is what a prose copy can wrongly claim, and a
   * complement that had collapsed to nothing would leave that direction
   * asserting over the empty set.
   */
  function expectTheVocabularyIsWiderThanTheArms(): void {
    expect(reported.length).toBeGreaterThan(1);
    expect(
      STATE_ROOT_ARTIFACTS.filter((name) => !reported.includes(name)).length,
    ).toBeGreaterThan(0);
  }

  it("flume loop --help's exit 74 row names every artifact a real start-up I/O refusal reports, and no others", async () => {
    expectTheVocabularyIsWiderThanTheArms();

    const { out, code } = await runCli(process.cwd(), ["loop", "--help"]);
    expect(code).toBe(0);
    const rows = documentedExitCodeRows(out);
    const ioRow = rows.get(EX_IOERR);
    expect(ioRow, `the block lists no ${EX_IOERR} row`).toBeDefined();

    // The read is one row, not the block: the exit-1 row names an artifact of
    // its own — the stop flag it refuses over when the flag is merely present
    // — and a reader handing back the whole block would hold the same set for
    // both rows.
    const refusalRow = artifactsNamedIn(rows.get(1) ?? "");
    expect(refusalRow.length, "the exit-1 row names no artifact").toBeGreaterThan(0);
    expect(
      refusalRow,
      "the row read handed back the same set for two rows",
    ).not.toEqual(reported);

    // Exactly the driven set, in both directions: an arm the run gained and
    // the row never named is red, and so is an artifact the row names that no
    // start-up refusal reports.
    expect(artifactsNamedIn(ioRow!)).toEqual(reported);
  }, SPAWN_BUDGET_MS);

  it("docs/CLI.md's flume loop section names every artifact a real start-up I/O refusal reports, and no others", async () => {
    expectTheVocabularyIsWiderThanTheArms();

    const section = sectionOf(await readCliDoc(), /^## `flume loop\b/);
    expect(section.length).toBeGreaterThan(0);

    const ioSentences = sentencesNamingExitCode(section, EX_IOERR);
    // Vacuity: a window that collapsed to one sentence, or to none, agrees
    // with a page that documents one cause or no causes at all.
    expect(ioSentences.length).toBeGreaterThan(1);

    // The window is scoped to this code rather than to the section: the
    // terminal-misconfiguration arm names an artifact too, and names fewer of
    // them, so a reader handing back the whole section cannot pass here.
    const misconfigured = artifactsNamedIn(
      sentencesNamingExitCode(section, EX_TERMINAL_MISCONFIG).join("\n"),
    );
    expect(
      misconfigured.length,
      `the ${EX_TERMINAL_MISCONFIG} window names no state-root artifact`,
    ).toBeGreaterThan(0);
    expect(
      misconfigured,
      "the per-code read handed back the same set for two codes",
    ).not.toEqual(reported);

    // Exactly the driven set, in both directions, as above.
    expect(artifactsNamedIn(ioSentences.join("\n"))).toEqual(reported);
  });
});

/**
 * CHECK-NO-FANOUT-SKIP-IN-PROSE — `check`'s third route to 0. A chain with
 * no fanout phase has no consumer, so the fence step is skipped and the
 * verb says so (spec/cli.md, "Subcommand surface"); both prose surfaces
 * described the fence as unconditional and left that route undocumented.
 *
 * The phrase under test is never hand-copied here: each pin drives the real
 * writer — `flume check` over a fanout-less chain — and asserts the surface
 * carries the clause that run actually printed
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("flume check's no-consumer skip is documented (CHECK-NO-FANOUT-SKIP-IN-PROSE)", () => {
  /**
   * Run `flume check` over a chain declaring one singleton phase and
   * nothing that picks from pending; return the clause its skip line
   * carried past the parse report. The queue's entry declares files —
   * declared paths are what makes a skipped fence distinguishable from an
   * empty one refusing them all.
   *
   * Run once for the suite, off the per-test budget ({@link clause}).
   */
  async function skipClause(): Promise<string> {
    const dir = await mkFixtureRoot("flume-check-no-fanout-");
    try {
      // The fence is this fixture's own — a plan phase writing only its own
      // dir — so the chain source is spelled here rather than taken from
      // `minimalChainSrc`, which declares `["**"]`.
      await writeRepoConfig(
        dir,
        `export default () => ({ chain: {\n` +
          `  phases: [{\n` +
          `    name: "plan",\n` +
          `    description: "",\n` +
          `    promptPath: "prompts/prompt.md",\n` +
          `    concurrency: "singleton",\n` +
          `    writablePaths: [".flume/plan/**"],\n` +
          `    gates: [],\n` +
          `    handoff: () => [],\n` +
          `  }],\n` +
          `  humanOnly: [],\n` +
          `} });\n`,
      );
      await mkdir(join(dir, ".flume", "plan"), { recursive: true });
      await writeFile(
        join(dir, ".flume", "plan", "pending.json"),
        JSON.stringify([
          {
            tag: "DECLARES-FILES",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: {
              new: [],
              edit: [
                { path: "docs/readme.md", description: "declared, unfenced" },
              ],
              retire: [],
            },
          },
        ]) + "\n",
        "utf8",
      );

      const { out, code } = await runCli(dir, ["check"]);
      expect(code).toBe(0);
      const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
      // Cut the parse report — "<rel> valid (N entries), " carries this
      // run's own counts, which no prose surface can restate.
      const cut = line.indexOf("), ");
      expect(cut).toBeGreaterThan(-1);
      const clause = line.slice(cut + "), ".length);
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).not.toBe(line);
      return clause;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * The real writer's clause, produced once for the whole suite. Both cases
   * below check a prose surface against it and the `--help` case spawns its
   * own subject on top, so the shared run rides the hook's budget rather
   * than making either case a two-spawn test — the default lane's carve-out
   * covers the one spawn a CLI-surface case *is* (spec/worktrees.md, "The
   * default test lane must stay fast").
   */
  let clause: string;
  beforeAll(async () => {
    clause = await skipClause();
  }, SPAWN_BUDGET_MS);

  it("flume check --help names the no-fanout skip among the ways check exits 0", async () => {
    const { out, code } = await runCli(process.cwd(), ["check", "--help"]);
    expect(code).toBe(0);
    const zero = out.slice(out.indexOf("\n  0 "), out.indexOf("\n  2 "));
    expect(zero.length).toBeGreaterThan(0);
    // Wrapped across help-text lines, so collapse whitespace before matching.
    expect(zero.replace(/\s+/g, " ")).toContain(clause);
  }, SPAWN_BUDGET_MS);

  it("docs/CLI.md's flume check section names the no-fanout skip", async () => {
    const section = sectionOf(await readCliDoc(), "## `flume check`");
    expect(section.length).toBeGreaterThan(0);
    expect(section.replace(/\s+/g, " ")).toContain(clause);
  });
});

/**
 * ABORT-SIGNATURE-NAMES-ITS-STAGE — `flume loop --help`'s exit-1 prose
 * describes the consecutive-failure backstop, which fires on a wall at any
 * stage the engine's roster names. Neither half of the vocabulary is
 * hand-copied here: the stages come from `FAILURE_STAGES`
 * (`src/loopSupervisor.ts`), the roster the supervisor itself folds by, and
 * each stage's *phrase* is read off `loopCompletionSummary`
 * (`src/cliVerdict.ts`), the real writer of the line an operator sees when
 * the backstop trips. The help text must name every phrase that writer can
 * emit (`.claude/rules/engineering.md`, "A seam gate reads what the real
 * writer wrote").
 */
describe("flume loop --help — the abort backstop's stage vocabulary against loopCompletionSummary's (ABORT-SIGNATURE-NAMES-ITS-STAGE)", () => {
  it("flume loop --help names every FAILURE_STAGES member as an abort stage", async () => {
    const { out, code } = await runCli(process.cwd(), ["loop", "--help"]);
    expect(code).toBe(0);
    const clause = out.slice(out.indexOf("\n  1 "), out.indexOf("\n  74 "));
    expect(clause.length).toBeGreaterThan(0);
    // Wrapped across help-text lines, so collapse whitespace before matching.
    const prose = clause.replace(/\s+/g, " ");
    expect(FAILURE_STAGES.length).toBeGreaterThan(0);
    for (const stage of FAILURE_STAGES) {
      const summary = loopCompletionSummary({
        ticks: 3,
        hibernated: false,
        repeatedFailure: { stage, signature: "SIG", count: 3 },
        shippedTags: [],
        erroredTicks: [],
        agentUsageByPhase: [],
      });
      // The phrase the real writer emits for this stage...
      expect(summary).toContain(`${stage}-stage`);
      // ...is the phrase the help text owes the operator.
      expect(prose).toContain(`${stage}-stage`);
    }
    expect(prose).not.toContain("worktree provisioning");
  }, SPAWN_BUDGET_MS);
});

/**
 * HELP-ABORT-THRESHOLD-IS-OVERRIDABLE — both exit-1 surfaces stated the
 * consecutive-failure backstop as a fixed three ticks, which is wrong for any
 * chain declaring `supervisorPolicy.abortThreshold`
 * (`.claude/rules/engine-boundary.md`, "Routing rule": a policy constant is an
 * overridable default, never fixed behavior). Help prints before any chain is
 * resolved, so the surface names the knob rather than rendering a run's value;
 * the default it quotes is interpolated from {@link DEFAULT_ABORT_THRESHOLD},
 * the same constant `superviseLoop` falls back to, so the number cannot drift
 * from the engine's (`.claude/rules/engineering.md`, "Derived state is
 * computed, never restated beside its source").
 */
describe("flume loop --help — the backstop threshold names its knob (HELP-ABORT-THRESHOLD-IS-OVERRIDABLE)", () => {
  /**
   * The exit-1 clause of a help surface, whitespace-collapsed: help text
   * wraps the prose across lines, so a phrase match needs one line.
   */
  function exitOneClause(out: string, nextCodeMarker: string): string {
    const start = out.indexOf("\n  1 ");
    const end = out.indexOf(nextCodeMarker);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return out.slice(start, end).replace(/\s+/g, " ");
  }

  /** What every backstop-describing surface owes an operator. */
  function expectsOverridableThreshold(prose: string): void {
    expect(prose.length).toBeGreaterThan(0);
    // The knob a chain overrides, by the name it is declared under.
    expect(prose).toContain("supervisorPolicy.abortThreshold");
    // The engine's default, quoted as a default...
    expect(prose).toContain(`default ${DEFAULT_ABORT_THRESHOLD}`);
    // ...and never as the count the backstop always fires on.
    expect(prose).not.toMatch(/\d+ consecutive ticks/);
  }

  it("flume loop --help names supervisorPolicy.abortThreshold rather than a fixed consecutive-tick count", async () => {
    const { out, code } = await runCli(process.cwd(), ["loop", "--help"]);
    expect(code).toBe(0);
    expectsOverridableThreshold(exitOneClause(out, "\n  74 "));
  }, SPAWN_BUDGET_MS);
});

/**
 * `flume status --help`'s exit-code block against the code the verb's own
 * claim reads really return. The help's 74 row described a stat that failed,
 * and only the presence probe could produce one: a claim file that stats and
 * will not open threw past the verb, so the exit an operator met was 1 with a
 * raw stack under a row promising 74. The fixture drives the real refusal and
 * reads the documented set off the real help text, never a copy
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("flume status --help — the exit-code list against the verb's own claim reads", () => {
  it("flume status --help names exit 74 for a claim file that cannot be read", async () => {
    const root = await mkFixtureRoot("flume-status-help-");
    try {
      // Non-vacuity: the verb really observes this bay before the claim file
      // is planted, so the refusal below is the unreadable claim's and not a
      // fixture that never reached the read.
      const printed = await runCli(root, ["status"]);
      expect(printed.code).toBe(0);
      expect(printed.out).toContain("hibernating");

      // A directory at the lock path: present to the probe, EISDIR to the
      // read that decodes the claim it states.
      await mkdir(loopLockPath(join(root, ".flume")));
      const refusal = await runCli(root, ["status"]);
      expect(refusal.out).toContain("failed to read");
      expect(refusal.code).toBe(EX_IOERR);

      const { out, code } = await runCli(root, ["status", "--help"]);
      expect(code).toBe(0);
      expect(ascending(documentedExitCodes(out))).toContain(refusal.code);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * `flume log --help`'s exit-code block against the code the verb's own I/O
 * refusal really returns. The verb's quiet arm is absence alone — no
 * tick-verdicts.jsonl prints nothing and exits 0 — so the refusal over a log
 * that is present and unreadable is an exit status an operator has to be
 * able to look up. The fixture drives the real refusal and reads the
 * documented set off the real help text, never a copy
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("flume log --help — the exit-code list against the verb's own I/O refusal", () => {
  it("flume log --help names exit 74 for a tick-verdicts.jsonl that cannot be read", async () => {
    const root = await mkFixtureRoot("flume-log-help-");
    try {
      const flumeDir = join(root, ".flume");
      await writeFile(
        tickVerdictsLogPath(flumeDir),
        JSON.stringify(logVerdict()) + "\n",
        "utf8",
      );
      // Non-vacuity: the verb really does print this history before the log
      // is denied, so the refusal below is the denial's and not a fixture
      // that never reached the read.
      const printed = await runCli(root, ["log"]);
      expect(printed.code).toBe(0);
      expect(printed.out).toContain("help-probe");

      denyFile(tickVerdictsLogPath(flumeDir));
      const refusal = await runCli(root, ["log"]);
      expect(refusal.out).toContain("failed to read");
      expect(refusal.code).toBe(EX_IOERR);

      const { out, code } = await runCli(root, ["log", "--help"]);
      expect(code).toBe(0);
      expect(ascending(documentedExitCodes(out))).toContain(refusal.code);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * FRICTION-LIST-STAT-REFUSAL-CLASSIFIED — `flume friction --help`'s
 * exit-code block against the code the verb's own I/O refusal really
 * returns. The fixture drives the real refusal (a channel dir readable but
 * not traversable: readdir enumerates the note, stat on it fails EACCES) and
 * the documented set is read off the real help text, so a refusal arm the
 * help never gained is red here instead of surfacing as an exit status no
 * operator was told about (`.claude/rules/engineering.md`, "A seam gate
 * reads what the real writer wrote").
 */
describe("flume friction --help — the exit-code list against the verb's own I/O refusal (FRICTION-LIST-STAT-REFUSAL-CLASSIFIED)", () => {
  const CHAIN_SRC = minimalChainSrc({ friction: "friction" });

  it.runIf(process.platform !== "win32")("flume friction --help names exit 74 for an I/O failure in the channel dir", async () => {
    const root = await mkFixtureRoot("flume-friction-help-");
    const frictionDir = join(root, ".flume", "friction");
    try {
      await writeRepoConfig(root, CHAIN_SRC);
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      await chmod(frictionDir, 0o444);

      const refusal = await runCli(root, ["friction"]);
      // Non-vacuity: the fixture has to have reached the list's stat arm —
      // a chain that failed to load, or a channel read as empty, would
      // agree with any help text at all.
      expect(refusal.out).toContain("friction/a.md");
      expect(refusal.out).toContain("failed to read");
      expect(refusal.code).toBe(EX_IOERR);

      const { out, code } = await runCli(root, ["friction", "--help"]);
      expect(code).toBe(0);
      expect(ascending(documentedExitCodes(out))).toContain(refusal.code);
    } finally {
      await chmod(frictionDir, 0o755).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * FLUME-HELP-IS-THE-SAME-ANSWER — `flume help` answered `unknown command:
 * help`, refusing the one question the bare verb exists to ask: it is what an
 * operator types at a command line they have not run before, ahead of knowing
 * the flag spelling (spec/cli.md, *Subcommand surface*).
 *
 * Both spellings are driven through the real CLI and read against each other,
 * never against a copy of the usage text — there is one `HELP_TOP`, and what
 * this case is about is the arm on the dispatch
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("flume help — the bare verb against the flag (FLUME-HELP-IS-THE-SAME-ANSWER)", () => {
  it("flume help prints the same usage as flume --help and exits 0", async () => {
    // A bay of its own, holding no chain: the state a chain load refuses on
    // and a baton read writes into, so both are observable below.
    const dir = await mkFixtureRoot("flume-help-verb-");
    try {
      // Vacuity: the flag's answer is the real top-level usage before it
      // stands as the expected value for anything.
      const flag = await runCliStreams(dir, ["--help"]);
      expect({ code: flag.code, stderr: flag.stderr }).toEqual({
        code: 0,
        stderr: "",
      });
      expect(flag.stdout).toContain("Usage: flume <command> [options]");
      expect(flag.stdout).toContain("\nCommands:\n");

      const verb = await runCliStreams(dir, ["help"]);
      expect(verb).toEqual(flag);

      // Short-circuited above every side effect: the bay the run resolved to
      // is as empty as the fixture planted it — no chain load attempted, no
      // `awake/` written by a baton.
      expect(await readdir(join(dir, ".flume"))).toEqual([]);

      // Non-vacuity for that absence: in this same directory a verb that does
      // load the chain and construct the baton leaves both traces, so the
      // empty bay above is the short-circuit's doing rather than a fixture
      // nothing could have marked.
      const status = await runCliStreams(dir, ["status"]);
      expect(status.code).toBe(0);
      expect(status.stderr).toContain("chain failed to load");
      expect(await readdir(join(dir, ".flume"))).toEqual(["awake"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * FLUME-HELP-ANSWERS-FOR-A-SUBCOMMAND — `flume help status` printed the
 * top-level listing and dropped the name, so the bare verb an operator
 * reaches for before learning the flag spelling was the one verb whose
 * argument went nowhere. FLUME-HELP-FLAG-ANSWERS-FOR-A-SUBCOMMAND — the same
 * drop survived on the flag spelling, `flume --help status`, because the
 * lookup was gated on the bare verb alone (spec/cli.md, *Subcommand
 * surface*). The short flag `-h <name>` is the third spelling the one
 * decider serves; it holds today and is pinned here, so narrowing that arm
 * back to two spellings cannot ship green.
 *
 * Each spelling pair is driven through the real CLI and read against the
 * other, never against a copy of the page — there is one writer per page and
 * what these cases are about is the dispatch arm that reaches it
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("flume help <name> and flume --help <name> — the trailing name through one decider (FLUME-HELP-ANSWERS-FOR-A-SUBCOMMAND, FLUME-HELP-FLAG-ANSWERS-FOR-A-SUBCOMMAND)", () => {
  /** The spellings that carry a trailing name to the same decider. */
  type Lead = "help" | "--help" | "-h";

  /**
   * `flume <lead> <name>` against `flume <name> --help`, in a bay holding no
   * chain: the trailing `--help` form is pinned as the real page carrying
   * `marker` before it stands as the expected value, then the leading form
   * is read against it whole — both streams and the status.
   */
  async function expectLeadingHelpMatchesFlag(
    lead: Lead,
    name: string,
    marker: string,
  ): Promise<void> {
    const dir = await mkFixtureRoot("flume-help-name-");
    try {
      const flag = await runCliStreams(dir, [name, "--help"]);
      expect({ code: flag.code, stderr: flag.stderr }).toEqual({
        code: 0,
        stderr: "",
      });
      expect(flag.stdout).toContain(marker);

      const leading = await runCliStreams(dir, [lead, name]);
      expect(leading).toEqual(flag);

      // Short-circuited above every side effect, on this arm as on the bare
      // verb's: the bay is as empty as the fixture planted it — no chain load
      // attempted, no `awake/` written by a baton. The non-vacuity for that
      // absence is the bare verb's own case above, where a verb that does
      // load the chain leaves both traces in this same fixture.
      expect(await readdir(join(dir, ".flume"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * An unknown trailing name on `lead`: usage-shaped, echoing the spelling
   * that was typed, with stdout empty rather than carrying the top-level
   * listing — the drop these cases exist to refuse.
   */
  async function expectUnknownNameRefuses(lead: Lead): Promise<void> {
    const dir = await mkFixtureRoot("flume-help-unknown-");
    try {
      const { stdout, stderr, code } = await runCliStreams(dir, [
        lead,
        "stauts",
      ]);
      expect({ code, stdout }).toEqual({ code: 2, stdout: "" });
      expect(stderr).toContain("no help page for: stauts");
      expect(stderr).toContain(`usage: flume ${lead} [<command>]`);
      expect(await readdir(join(dir, ".flume"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("flume help status prints the status subcommand's usage", async () => {
    await expectLeadingHelpMatchesFlag("help", "status", "Usage: flume status");
  }, SPAWN_BUDGET_MS);

  it("flume help friction prints the friction subcommand's usage", async () => {
    await expectLeadingHelpMatchesFlag(
      "help",
      "friction",
      "Usage: flume friction",
    );
  }, SPAWN_BUDGET_MS);

  it("flume --help status prints the status subcommand's usage", async () => {
    await expectLeadingHelpMatchesFlag(
      "--help",
      "status",
      "Usage: flume status",
    );
  }, SPAWN_BUDGET_MS);

  it("flume -h status prints the status subcommand's usage", async () => {
    await expectLeadingHelpMatchesFlag("-h", "status", "Usage: flume status");
  }, SPAWN_BUDGET_MS);

  it("flume help with an unknown name exits 2 with usage", async () => {
    await expectUnknownNameRefuses("help");
  }, SPAWN_BUDGET_MS);

  it("flume --help with an unknown name exits 2 with usage", async () => {
    await expectUnknownNameRefuses("--help");
  }, SPAWN_BUDGET_MS);

  it("flume -h with an unknown name exits 2 with usage", async () => {
    await expectUnknownNameRefuses("-h");
  }, SPAWN_BUDGET_MS);

  /**
   * The listing against the decider: every command `flume --help` advertises
   * is a name `flume help <name>` answers. A command added to the table and
   * not to a page would otherwise ship a listed name whose help refuses.
   */
  it("every command the top-level listing advertises has a page flume help reaches", () => {
    const names = topLevelCommandNames();
    // Vacuity: an unparsed block would leave nothing to judge, and every
    // name below would hold over the empty set.
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("friction");
    expect(names.filter((name) => helpPageFor(name) === undefined)).toEqual([]);
  });
});

/**
 * EVERY-VERBS-HELP-NAMES-THE-IO-REFUSAL — `EX_IOERR` is cross-cutting rather
 * than any one verb's: bay discovery stats the nearest state root at the top
 * of `main`, before dispatch, so every verb's process can return 74
 * (spec/loop.md, *Exit codes — the run never lies to CI*). Four pages —
 * `wake`, `sleep`, `stop`, `render` — listed no 74 row at all and so
 * understated their own range.
 *
 * Both cases read the verb set off the surface rather than restating it, so
 * a verb added later is judged here the tick it is added rather than the
 * tick someone remembers to extend a list.
 */
describe("the cross-cutting I/O refusal on every verb's page (EVERY-VERBS-HELP-NAMES-THE-IO-REFUSAL)", () => {
  it("every subcommand's --help names exit 74", () => {
    const names = topLevelCommandNames();
    // Vacuity: an unparsed listing would hold the emptiness below over zero
    // verbs, and the named one is a page that carried no 74 row before this
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("wake");

    // A verb whose page this surface does not answer is a silence of its own
    // — there is no exit-code block to read — so it fails here rather than
    // being skipped.
    const silent = names.filter((name) => {
      const page = helpPageFor(name);
      return page === undefined || !documentedExitCodes(page).has(EX_IOERR);
    });
    expect(silent).toEqual([]);
  });

  it("docs/CLI.md's wake, sleep, stop and render sections name exit 74", async () => {
    const page = await readCliDoc();
    for (const verb of ["wake", "sleep", "stop", "render"]) {
      const section = sectionOf(page, new RegExp(`^## \`flume ${verb}\\b`));
      expect(section.length, verb).toBeGreaterThan(0);

      // Vacuity: a section whose range was not read at all — a heading that
      // moved, a phrasing the reader no longer keys on — would leave the
      // membership below asserting over the empty set.
      const codes = namedExitCodes(section);
      expect(codes.length, verb).toBeGreaterThan(1);
      expect(codes, verb).toContain(EX_IOERR);
    }
  });
});
