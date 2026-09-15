/**
 * Help-text and subcommand-table seam — split from tests/cli.test.ts along
 * the same seam as `src/cliHelp.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick").
 */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { EX_IOERR } from "../src/cli.ts";
import {
  loopCompletionSummary,
  loopExitCode,
  tickExitCode,
} from "../src/cliVerdict.ts";
import { RUNTIME_IGNORES } from "../src/job.ts";
import {
  DEFAULT_ABORT_THRESHOLD,
  FAILURE_STAGES,
} from "../src/loopSupervisor.ts";
import type { SuperviseResult } from "../src/loopSupervisor.ts";
import type { TickOutcome, TickVerdict } from "../src/Dispatcher.ts";
import type { TickResult } from "../src/Phase.ts";
import {
  SPAWN_BUDGET_MS,
  mkFixtureRoot,
  runCli,
} from "./helpers/subprocess.ts";

/**
 * The codes a `--help` text's own "Exit codes:" block lists — read off the
 * real help output, never restated, so both suites below compare a real
 * producer against the shipped prose rather than against a hand copy.
 */
function documentedExitCodes(help: string): Set<number> {
  const start = help.indexOf("Exit codes:\n");
  expect(start).toBeGreaterThan(-1);
  const codes = new Set<number>();
  for (const line of help.slice(start).split("\n").slice(1)) {
    if (line.trim() === "") continue;
    // A continuation line is indented past its code; anything unindented
    // ended the block.
    if (!line.startsWith("  ")) break;
    const listed = /^ {2}(\d+) {2,}\S/.exec(line);
    if (listed) codes.add(Number(listed[1]));
  }
  return codes;
}

const ascending = (codes: Iterable<number>): number[] =>
  [...new Set(codes)].sort((a, b) => a - b);

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
]);

/*
 * The `flume loop` / `flume job run` process's exit-code range, in the same
 * two halves: the codes `loopExitCode` (`src/cliVerdict.ts`) maps a
 * `SuperviseResult` to, and the codes the process returns without ever
 * reaching it. `docs/CLI.md` §§ `flume loop` and `flume job run` each
 * restate this range, and each is pinned against the producer below rather
 * than against the other copy or against the `--help` blocks — two prose
 * copies compared to each other move together in the commit that changes
 * the behavior, and agree while both are wrong.
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
    "the stop flag or the merging-marker dir exists but could not be read",
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
 * The exit codes a `docs/CLI.md` section names. The page writes a code as a
 * backticked bare integer introduced by the word "exit" — "exits `69`",
 * "refuses (exit `1`)", "Exit code stays `0`" — and that context is what
 * makes the read a claim about the verb's range rather than about any
 * number the prose happens to backtick. These sections also backtick
 * integers that are values (`--max`'s default), and a value read as a code
 * would put the page permanently at odds with every producer. The window
 * between the word and the code admits no backtick, so the two must sit in
 * one clause.
 */
function namedExitCodes(section: string): number[] {
  const codes = new Set<number>();
  for (const [, code] of section.matchAll(/\bexits?\b[^`\n]{0,24}`(\d+)`/gi)) {
    codes.add(Number(code));
  }
  return ascending(codes);
}

/** One `## `-delimited section of the page, heading included. */
function docSection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const next = doc.indexOf("\n## ", start + 1);
  return next === -1 ? doc.slice(start) : doc.slice(start, next);
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
 * the behavior, and agree while both are wrong (`.claude/rules/
 * engineering.md`, "A seam gate reads what the real writer wrote").
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

    const section = docSection(await readCliDoc(), "## `flume tick`");
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
 * CLI-DOC-LOOP-EXIT-CODES-PINNED — `docs/CLI.md` §§ `flume loop` and `flume
 * job run` are the loop range's two prose copies, and both had drifted: the
 * loop section named 0, 1 and 69 and neither the usage code, the I/O
 * refusal nor the terminal-misconfiguration code; `job run` missed the I/O
 * refusal. Each is pinned against the same driven producer —
 * `loopExitCode` over the `SuperviseResult` space, beside the named
 * start-up set — never against the other section and never against the
 * `--help` blocks (`.claude/rules/engineering.md`, "A seam gate reads what
 * the real writer wrote").
 */
describe("docs/CLI.md's loop sections against loopExitCode's derived range (CLI-DOC-LOOP-EXIT-CODES-PINNED)", () => {
  /**
   * Both sections make the same claim about the same range, so both take
   * the same check: exactly the range, in both directions, plus the reader
   * discrimination that claim rests on.
   */
  async function expectSectionNamesTheLoopRange(heading: string): Promise<void> {
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

    const section = docSection(await readCliDoc(), heading);
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
    await expectSectionNamesTheLoopRange("## `flume loop");
  });

  it("docs/CLI.md's flume job run section names every exit code the real loop range produces", async () => {
    await expectSectionNamesTheLoopRange("## `flume job run");
  });
});

/**
 * JOB-HELP-NAMES-THE-WHOLE-LOOP-RANGE — the loop range's two *runtime* prose
 * copies. `flume job run` rewrites the command to `loop` and relays its exit
 * code verbatim, while the other job verbs return only 0/1/2, so `flume job
 * --help`'s block owes exactly the loop range — and it named 0, 1, 2 and 78
 * alone: an operator hitting a child tick's mount-dead (69) or a start-up
 * I/O refusal (74) read a status the surface never mentioned. Each block is
 * driven against `loopExitCode` beside the named start-up set, never against
 * the other block or against `docs/CLI.md` — two prose copies compared to
 * each other move together in the commit that changes the behavior, and
 * agree while both are wrong (`.claude/rules/engineering.md`, "A seam gate
 * reads what the real writer wrote").
 */
describe("the --help blocks that restate the loop range, against loopExitCode's derived range (JOB-HELP-NAMES-THE-WHOLE-LOOP-RANGE)", () => {
  /**
   * Both surfaces make the same claim about the same range, so both take
   * the same check: the block's own listed codes, read off the real help
   * output, equal to the whole range in both directions — a code the run
   * gained and the block never named is red, and so is a code the block
   * names that no longer reaches an operator through it.
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

  it("flume job --help names every exit code the loop range produces, since job run relays it", async () => {
    await expectHelpNamesTheLoopRange(["job", "--help"]);
  }, SPAWN_BUDGET_MS);
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
      await mkdir(join(dir, ".flume", "prompts"), { recursive: true });
      await mkdir(join(dir, ".flume", "plan"), { recursive: true });
      await writeFile(
        join(dir, ".flume", "chain.ts"),
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
        "utf8",
      );
      await writeFile(
        join(dir, ".flume", "prompts", "prompt.md"),
        "probe prompt\n",
        "utf8",
      );
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
    const doc = await readFile(
      fileURLToPath(new URL("../docs/CLI.md", import.meta.url)),
      "utf8",
    );
    const start = doc.indexOf("## `flume check`");
    expect(start).toBeGreaterThan(-1);
    const next = doc.indexOf("\n## ", start + 1);
    const section = next === -1 ? doc.slice(start) : doc.slice(start, next);
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
 * consecutive-failure backstop as a fixed three ticks, which is wrong for
 * any chain declaring `supervisorPolicy.abortThreshold`
 * (`engine-boundary.md`, "Routing rule": a policy constant is an
 * overridable default, never fixed behavior). Help prints before any chain
 * is resolved, so the surface names the knob rather than rendering a run's
 * value; the default it quotes is interpolated from
 * {@link DEFAULT_ABORT_THRESHOLD}, the same constant `superviseLoop`
 * falls back to, so the number cannot drift from the engine's
 * (`engineering.md`, "Derived state is computed, never restated beside its
 * source").
 */
describe("flume loop/job --help — the backstop threshold names its knob (HELP-ABORT-THRESHOLD-IS-OVERRIDABLE)", () => {
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

  it("flume job --help names supervisorPolicy.abortThreshold rather than a fixed consecutive-tick count", async () => {
    const { out, code } = await runCli(process.cwd(), ["job", "--help"]);
    expect(code).toBe(0);
    expectsOverridableThreshold(exitOneClause(out, "\n  2 "));
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
  const CHAIN_SRC =
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: "probe",\n` +
    `    description: "",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `  friction: "friction",\n` +
    `} });\n`;

  it("flume friction --help names exit 74 for an I/O failure in the channel dir", async () => {
    const root = await mkFixtureRoot("flume-friction-help-");
    const frictionDir = join(root, ".flume", "friction");
    try {
      await mkdir(join(root, ".flume", "prompts"), { recursive: true });
      await writeFile(join(root, ".flume", "chain.ts"), CHAIN_SRC, "utf8");
      await writeFile(
        join(root, ".flume", "prompts", "prompt.md"),
        "probe prompt\n",
        "utf8",
      );
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
 * JOB-NEW-HELP-INTERPOLATES-RUNTIME-IGNORES — the `new` verb's help named
 * five of the ten entries `jobNew` really merges, a hand copy that had
 * already gone stale against the runtime's layout. The roster is now read
 * off {@link RUNTIME_IGNORES} itself (`.claude/rules/engineering.md`,
 * "Derived state is computed, never restated beside its source"), so this
 * drives the real CLI and compares its printed block against the constant
 * the seeding code merges — the real writer's value through the real
 * surface, not a fixture of either.
 */
it("job new help names every RUNTIME_IGNORES entry", async () => {
  const { out, code } = await runCli(process.cwd(), ["job", "new", "--help"]);
  expect(code).toBe(0);

  // Vacuity pin: an empty constant would let any help text at all pass.
  expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
  for (const entry of RUNTIME_IGNORES) expect(out).toContain(entry);

  // ...and nothing respelled beside them: the printed block, unwrapped, is
  // exactly the constant, so an entry dropped or invented here is red.
  const marker = "The entries merged:\n";
  const start = out.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const block = out.slice(start + marker.length, out.indexOf("\n\n", start));
  expect(block.replace(/\s+/g, " ").trim()).toBe(RUNTIME_IGNORES.join(", "));
}, SPAWN_BUDGET_MS);
