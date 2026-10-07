/**
 * Help-text and subcommand-table seam — split from tests/cli.test.ts along
 * the same seam as `src/cliHelp.ts` (`.claude/rules/engineering.md`, *A
 * module is one job*).
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
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  EX_DATAERR,
  EX_IOERR,
  EX_MOUNT_DEAD,
  EX_TERMINAL_MISCONFIG,
} from "../src/exitCodes.ts";
import {
  RENDER_REFUSED_PHRASES,
  TICK_RENDER_REFUSED_PHRASES,
  SHARED_ROOT_ONLY_LEAD,
  ROOT_RESOLUTION_USAGE_PHRASES,
  ROOT_ACCESS_PHRASE,
  SHARED_ROOT_RESOLUTION_PHRASES,
  TICK_TIP_CLAIM_HELD_PHRASE,
  helpPageFor,
} from "../src/cliHelp.ts";
import {
  STATE_ROOT_DIRNAME,
  awakeDir,
  STATE_ROOT_NAMES,
  loopLockPath,
  mergingDir,
  stopFlagPath,
} from "../src/paths.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import {
  docCommentFor,
  docProse,
  srcText,
} from "./helpers/docComments.ts";
import { currentRefPath, gitCommonDir, tipClaimPath } from "../src/git.ts";
import { renderPidClaim } from "../src/pidClaim.ts";
import {
  loopCompletionSummary,
  loopExitCode,
  tickExitCauses,
  tickExitCode,
  tickExitPhrases,
} from "../src/cliVerdict.ts";
import {
  DEFAULT_ABORT_THRESHOLD,
  FAILURE_STAGES,
  MOUNT_DEAD_RE_READ_LEGS,
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
import { parseMaxValue } from "../src/cliArgs.ts";
import {
  COUNT_FLAG_CLASS_LEAD,
  COUNT_FLAG_REFUSAL_PHRASES,
  NOT_A_DECIMAL_INTEGER,
} from "./helpers/countFlagClass.ts";
import { denyDirectory, denyFile } from "./helpers/denial.ts";
import { hermeticEnv } from "./helpers/gitEnv.ts";
import { minimalChainSrc, writeRepoConfig } from "./helpers/repoChain.ts";
import {
  bulletOf,
  namedExitCodes,
  sectionOf,
  sentencesNamingExitCode,
} from "./helpers/docSections.ts";
import { topLevelCommandNames } from "./helpers/shippedHelp.ts";
import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import { makeScratchRepo } from "./helpers/scratchRepo.ts";
import { STAMP_SOURCE } from "./helpers/stampedLine.ts";
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
    timings: [],
    summary: "help-probe: one tick",
    headSha: "0".repeat(40),
    at: "2024-01-01T00:00:00.000Z",
  };
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
 * happens to quote (`.claude/rules/posture-sweep.md`, *A negative assertion
 * over a whole rendered artifact*).
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
 *
 * 1 is *not* here, though cli.ts returns it on those refusals too: a tick
 * whose ledger commit refused outside a parse failure reaches 1 through the
 * outcome as well, so the driven half already owns the code and the
 * disjointness assertion below is what keeps this set honest about it.
 */
const TICK_PROCESS_LEVEL_EXIT_CODES = new Map<number, string>([
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
  priorAttempts: new Map(),
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
  timings: [],
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
  ledgerRefusal: [ABSENT, "parse-failure", "commit-refusal"],
  usageError: [ABSENT, false, true],
  tipMoved: [ABSENT, false, true],
  declined: [ABSENT, false, true],
  terminal: [ABSENT, { kind: "orphaned-awake", phases: ["ghost"] }],
  undeclaredPhase: [
    ABSENT,
    { requested: "ghost", declared: ["plan", "build"] },
  ],
  heldPhases: [ABSENT, ["plan"]],
  promptUnreadable: [
    ABSENT,
    { promptPath: "prompts/plan.md", resolvedPath: "/repo/.flume/prompts/plan.md" },
  ],
  phaseName: [ABSENT, "plan"],
  result: [ABSENT, A_TICK_RESULT],
  noCommit: [ABSENT, "clean-exit"],
  provisionFailures: [ABSENT, [A_STAGE_FAILURE]],
  renderFailures: [ABSENT, [A_STAGE_FAILURE]],
  mergeFailures: [ABSENT, [A_STAGE_FAILURE]],
  gateFailures: [ABSENT, [A_STAGE_FAILURE]],
  platformFailures: [ABSENT, [A_STAGE_FAILURE]],
  shipFailures: [ABSENT, [A_STAGE_FAILURE]],
  unclassedWalls: [ABSENT, [{ event: "a slot leg threw", ...A_STAGE_FAILURE }]],
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
  heldPhases: [ABSENT, ["plan"]],
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
 * The other half of the range read above: the block lists the right codes,
 * and each row states the cause of the arm that returns it. Those causes were
 * hand-copied prose beside the classifier, so a code re-routed between two
 * arms already inside the range shipped green over both copies
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * Driven the way the range is: the real classifier over the real outcome
 * space for the codes, the labels its arms carry for the causes, and the
 * shipped page decoded by the same block reader — never a hand copy of
 * either side (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 */
it("flume tick --help renders each exit code's cause from the label its arm carries", () => {
  const page = helpPageFor("tick");
  expect(page).toBeDefined();
  const rows = documentedExitCodeRows(page!);
  const { returned, spanned } = driveTickExitCodes();
  // Non-vacuity: a collapsed outcome space, or a range that collapsed, would
  // leave every read below holding over almost nothing.
  expect(spanned).toBeGreaterThan(1);
  expect(returned.size).toBeGreaterThan(1);

  const labelled = [...returned].map(
    (code) => [code, tickExitCauses(code)] as const,
  );
  // Every code the classifier can return is labelled at its arm — a code
  // whose cause lives only on the page is the copy this pin exists to refuse.
  expect(
    labelled.filter(([, causes]) => causes.length === 0).map(([code]) => code),
  ).toEqual([]);
  // And one code carries two labels, which is what makes this a per-arm read
  // rather than a per-code one: 2 answers both an undeclared `--phase` name
  // and the CJS-context refusal, and a map keyed by code alone would hold
  // one of them.
  expect(
    Math.max(...labelled.map(([, causes]) => causes.length)),
  ).toBeGreaterThan(1);

  for (const [code, causes] of labelled) {
    const row = rows.get(code);
    expect(row, `the block lists no ${code} row`).toBeDefined();
    for (const cause of causes) {
      // The reader folds a row to one line, so this compares against the
      // clause the arm wrote rather than against where the page broke it.
      expect(
        row,
        `the ${code} row does not state the cause its arm carries`,
      ).toContain(cause.replace(/\s+/g, " "));
    }
  }
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
 * A passage as a phrase read compares it: the page's own wrapping folded
 * out, since a phrase broken across two source lines is one phrase, and case
 * folded, since a phrase opening a `--help` row is capitalized where the
 * same phrase mid-sentence on a page is not. Nothing else — the backticks a
 * phrase carries are part of what it names.
 */
function asStated(prose: string): string {
  return prose.replace(/\s+/g, " ").toLowerCase();
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
 * CLI-DOC-TICK-EXIT-CAUSES-PINNED-PER-ARM — the other half of the read
 * above. The page names the right codes, and each code's sentences state the
 * cause of the arm that returns it — the drift the `--help` block's own rows
 * already refuse, now for the second prose copy of the same range.
 *
 * The page cannot carry the block's clause whole: the block lays each cause
 * out as a standalone clause, the page spends one flowing sentence per verb
 * on the whole range. What crosses is the phrase each arm designates inside
 * its own clause (`tickExitPhrases`, `src/cliVerdict.ts`), so both surfaces
 * are read against the label the arm carries rather than against each other
 * — two prose copies compared to each other move together in the commit that
 * changes the behavior, and agree while both are wrong
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
describe("docs/CLI.md's flume tick causes against the labels their arms carry (CLI-DOC-TICK-EXIT-CAUSES-PINNED-PER-ARM)", () => {
  it("docs/CLI.md's flume tick section states each exit code's cause under the phrase its arm is labelled with", async () => {
    const { returned, spanned } = driveTickExitCodes();
    // Non-vacuity, as above: a collapsed outcome space or range would leave
    // every read below holding over almost nothing.
    expect(spanned).toBeGreaterThan(1);
    expect(returned.size).toBeGreaterThan(1);

    const labelled = [...returned].map(
      (code) => [code, tickExitPhrases(code)] as const,
    );
    // Every code the classifier returns is labelled at its arm, and one code
    // carries two labels — which is what makes this a per-arm read rather
    // than a per-code one, exactly as the block's own row read is.
    expect(
      labelled.filter(([, phrases]) => phrases.length === 0).map(([code]) => code),
    ).toEqual([]);
    expect(
      Math.max(...labelled.map(([, phrases]) => phrases.length)),
    ).toBeGreaterThan(1);
    // And each phrase is its arm's own span of the clause the block renders,
    // so the page below is read against the words the shipped help text
    // really carries rather than against a label nothing states.
    for (const [code, phrases] of labelled) {
      const clauses = asStated(tickExitCauses(code).join("\n"));
      for (const phrase of phrases) {
        expect(
          clauses,
          `the ${code} block rows do not state the phrase their arms are labelled with`,
        ).toContain(asStated(phrase));
      }
    }

    const section = sectionOf(await readCliDoc(), "## `flume tick`");
    expect(section.length).toBeGreaterThan(0);

    const windows = new Map(
      labelled.map(([code]) => [
        code,
        asStated(sentencesNamingExitCode(section, code).join("\n")),
      ]),
    );
    for (const [code, phrases] of labelled) {
      const window = windows.get(code)!;
      expect(
        window.length,
        `the section spends no sentence on ${code}`,
      ).toBeGreaterThan(0);
      for (const phrase of phrases) {
        expect(
          window,
          `the ${code} sentences do not state the cause its arm is labelled with`,
        ).toContain(asStated(phrase));
      }
    }

    // The window is scoped to one code rather than to the section: the page
    // documents the whole range in one paragraph, so a reader handing back
    // all of it would carry every arm's phrase into every code's window and
    // pass over a sentence that had gone silent.
    const missed = labelled.flatMap(([code]) =>
      labelled
        .filter(([other]) => other !== code)
        .flatMap(([, phrases]) => phrases)
        .filter((phrase) => !windows.get(code)!.includes(asStated(phrase))),
    );
    expect(
      missed.length,
      "the per-code read handed back the same text for every code",
    ).toBeGreaterThan(0);
  });
});

/**
 * The arm the two per-arm reads above cannot see: `tickExitCode` classifies
 * outcomes, and the tip-claim refusal is taken in `main` before an outcome
 * exists — so no arm carries it, and both surfaces spent their `1` row on the
 * claim being loop-level only, which is the opposite of what the verb does.
 *
 * Driven off a tick that really refused: one real `flume tick` over a
 * repository whose tip is held by a live process, beside the same tick with
 * no claim standing, so the phrase the page is read under is one the shipped
 * `--help` row renders for a refusal the verb really takes
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
it("docs/CLI.md's flume tick section states the live tip-claim refusal among its exit-1 causes", async () => {
  const repo = await makeScratchRepo("flume-tick-tip-claim-", "main");
  try {
    await writeRepoConfig(repo.dir, minimalChainSrc());
    const head = await currentRefPath(repo.dir);
    if (head.kind !== "ref") {
      throw new Error(`the fixture repository is not on a branch: ${head.kind}`);
    }
    const claimPath = tipClaimPath(await gitCommonDir(repo.dir), head.path);

    // Non-vacuity: the same tick with no claim standing reaches its own
    // hibernation, so the refusal below is the claim's and not a fixture
    // refusing everything handed to it.
    const clear = await runCli(repo.dir, ["tick"]);
    expect(clear.code, clear.out).toBe(0);
    expect(clear.out).toContain("hibernating");

    // A live holder: this process, which is alive by definition, stating a
    // state root of its own so the refusal has two roots to name. Composed by
    // the real writer of that statement (`renderPidClaim`,
    // `src/pidClaim.ts`) rather than hand-spelled — a hand copy would
    // re-author the claim format by the tester's hand.
    const holderRoot = join(repo.dir, "another-state-root");
    await mkdir(dirname(claimPath), { recursive: true });
    await writeFile(
      claimPath,
      renderPidClaim(process.pid, new Date(), holderRoot),
      "utf8",
    );

    const refused = await runCli(repo.dir, ["tick"]);
    expect(refused.code, refused.out).toBe(1);
    // And it is *this* refusal: the last line the run wrote names the holder
    // we planted, both roots, and the claim path — which is what tells it from
    // a tick that failed somewhere else for 1.
    const line = refused.out.trimEnd().split("\n").at(-1) ?? "";
    expect(line).toContain(`claimed by pid ${process.pid}`);
    expect(line).toContain(holderRoot);
    expect(line).toContain(claimPath);

    // The producer's side first: the phrase is a span of the clause the
    // shipped `1` row really renders, so the page below is read against what
    // an operator running `--help` sees rather than a label nothing states.
    const page = helpPageFor("tick");
    expect(page, "the help table answers no page for `tick`").toBeDefined();
    const row = documentedExitCodeRows(page!).get(1);
    expect(row, "the tick block lists no 1 row").toBeDefined();
    expect(
      asStated(row!),
      "the tick block's 1 row does not state the phrase its cause is labelled with",
    ).toContain(asStated(TICK_TIP_CLAIM_HELD_PHRASE));

    const section = sectionOf(await readCliDoc(), "## `flume tick`");
    expect(section.length).toBeGreaterThan(0);
    const window = asStated(sentencesNamingExitCode(section, 1).join("\n"));
    expect(window.length, "the section spends no sentence on 1").toBeGreaterThan(0);
    expect(
      window,
      "the section's 1 sentences do not state the tip-claim refusal",
    ).toContain(asStated(TICK_TIP_CLAIM_HELD_PHRASE));

    // The window is scoped to this code rather than to the section: the page
    // documents the whole range in one paragraph, so a reader handing back all
    // of it would carry this phrase into every code's window and pass over a
    // sentence that had gone silent.
    const scoped = namedExitCodes(section)
      .filter((code) => code !== 1)
      .filter(
        (code) =>
          !asStated(sentencesNamingExitCode(section, code).join("\n")).includes(
            asStated(TICK_TIP_CLAIM_HELD_PHRASE),
          ),
      );
    expect(
      scoped.length,
      "the per-code read handed back the whole section",
    ).toBeGreaterThan(0);
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

/**
 * The window every per-code doc read above is cut from, pinned on the page
 * shape that had widened it. `docs/CLI.md` states one flag's behavior in a
 * paragraph led by a bolded name, and a bolded lead opens with neither a
 * capital nor a backtick: the sentence break that ends a code's window read
 * past the blank line before it, so that paragraph arrived as the tail of the
 * sentence above — prose about the flag inside a neighbouring code's window,
 * where a containment read could be satisfied by an arm it is not about
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 *
 * The cut is read off the shipped page rather than a fixture: the paragraph
 * shape is what the sibling reads here run over, so a page that stops leading
 * a paragraph that way reds on this case's own non-vacuity instead of quietly
 * leaving the arm unexercised.
 */
describe("the per-exit-code window is cut at its own paragraph", () => {
  it("the per-exit-code page window ends where a paragraph opens with a bolded lead", async () => {
    const section = sectionOf(await readCliDoc(), "## `flume tick`");
    expect(section.length).toBeGreaterThan(0);

    const paragraphs = section.split(/\n[ \t]*\n/);
    // The shape this case is about, asserted before the verdict: a paragraph
    // of this section opens with a bolded lead, the paragraph above it closes
    // on a period — which is all a sentence break has to work with — and that
    // paragraph names an exit code, so gluing the two really would widen a
    // window.
    const glued = paragraphs.flatMap((paragraph, at) => {
      const lead = /^\*\*[^*\n]+\*\*/.exec(paragraph)?.[0];
      const above = at === 0 ? undefined : paragraphs[at - 1]!;
      if (lead === undefined || above === undefined) return [];
      if (!above.trimEnd().endsWith(".")) return [];
      return namedExitCodes(above).map((code) => ({ code, lead }));
    });
    expect(
      glued.length,
      "no bolded-lead paragraph of this section sits under a closed sentence naming a code",
    ).toBeGreaterThan(0);

    for (const { code, lead } of glued) {
      const window = sentencesNamingExitCode(section, code);
      expect(window.length, `the section spends no sentence on ${code}`).toBeGreaterThan(0);
      // The subject is the lead phrase, not whatever else the window quotes:
      // this reds only when the paragraph that lead opens has been carried
      // into a window cut for a code stated in the paragraph above it.
      expect(
        window.join("\n"),
        `the ${code} window carries the ${lead} paragraph`,
      ).not.toContain(lead);
    }
  });
});

/**
 * CLI-DOC-SHARED-ROOT-CAUSES-PINNED-PER-VERB — the refusals bay discovery
 * takes before any verb reaches work of its own. The help blocks render them
 * from one clause (`SHARED_ROOT_RESOLUTION_PHRASES`, `src/cliHelp.ts`); `docs/CLI.md`
 * spells them again per verb section, in its own register, and those copies
 * had drifted apart from each other and from the clause.
 *
 * Scoped by which rows render those causes, read off the shipped pages rather
 * than listed here, and that is every verb: bay discovery runs ahead of all
 * of them, so the row an operator reads states these causes whether or not
 * the verb has refusals of its own beside them (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*). The shared-only lead is
 * the narrower marker inside that scope — the verbs whose `74` row says the
 * state root's refusals are its only ones — and it is read here as the
 * witness that the scope is the causes' and not the lead's, never as the
 * scope itself: a page read drawn from the lead leaves every verb that
 * documents refusals of its own unpinned over the same three copies.
 *
 * The fourth cause the shared clause carries — the access refusal, which only
 * the verbs that reach the state under the root can take — is scoped by the
 * verbs that really take it rather than by every verb, and is pinned below
 * (CLI-VERB-PAGES-NAME-THE-STATE-ROOT-ACCESS-REFUSAL).
 */
describe("docs/CLI.md's per-verb copies of the shared state-root cause (CLI-DOC-SHARED-ROOT-CAUSES-PINNED-PER-VERB)", () => {
  it("every docs/CLI.md verb section whose 74 row renders the state-root resolution causes states all three of them", async () => {
    const names = topLevelCommandNames();
    const rowOf = (name: string): string => {
      const page = helpPageFor(name);
      expect(page, `the help table answers no page for \`${name}\``).toBeDefined();
      const row = documentedExitCodeRows(page!).get(EX_IOERR);
      expect(row, `flume ${name} --help lists no ${EX_IOERR} row`).toBeDefined();
      return asStated(row!);
    };
    const rendered = names.filter((name) =>
      SHARED_ROOT_RESOLUTION_PHRASES.every((phrase) => rowOf(name).includes(asStated(phrase))),
    );
    const sharedOnly = rendered.filter((name) =>
      rowOf(name).includes(asStated(SHARED_ROOT_ONLY_LEAD)),
    );
    // Non-vacuity, and the direction the title claims. The count is asserted
    // because the title names it: "all three" is a claim about the clause,
    // and a clause that lost an arm would leave this green over two.
    expect(SHARED_ROOT_RESOLUTION_PHRASES).toHaveLength(3);
    expect(sharedOnly.length).toBeGreaterThan(1);
    // And the scope is the clause's, not the lead's: a row rendering the
    // clause under a lead of its own is what the lead-scoped read left out,
    // so a scope that had collapsed back to the lead reds here.
    expect(
      rendered.length,
      "every verb rendering the clause says it is its only refusal — the lead is the whole scope",
    ).toBeGreaterThan(sharedOnly.length);

    const doc = await readCliDoc();
    for (const name of rendered) {
      // The producer's side first: the phrases are spans of the clause the
      // shipped row really renders, so the page is read against what an
      // operator running `--help` sees.
      const row = asStated(documentedExitCodeRows(helpPageFor(name)!).get(EX_IOERR)!);
      for (const phrase of SHARED_ROOT_RESOLUTION_PHRASES) {
        expect(
          row,
          `flume ${name} --help's ${EX_IOERR} row does not state one of its own causes`,
        ).toContain(asStated(phrase));
      }

      const section = sectionOf(doc, new RegExp(`^## \`flume ${name}\\b`));
      expect(section.length, `docs/CLI.md has no \`flume ${name}\` section`).toBeGreaterThan(0);
      const window = asStated(sentencesNamingExitCode(section, EX_IOERR).join("\n"));
      for (const phrase of SHARED_ROOT_RESOLUTION_PHRASES) {
        expect(
          window,
          `docs/CLI.md's flume ${name} section states no ${EX_IOERR} cause under one of the phrases the row renders`,
        ).toContain(asStated(phrase));
      }
    }

    // The window is scoped to this code rather than to the section: each of
    // these sections documents usage refusals too, and those sentences carry
    // none of the shared causes, so a reader handing back the whole section
    // could not tell a stated cause from a neighbouring one.
    const elsewhere = rendered.flatMap((name) => {
      const section = sectionOf(doc, new RegExp(`^## \`flume ${name}\\b`));
      return namedExitCodes(section)
        .filter((code) => code !== EX_IOERR)
        .flatMap((code) => {
          const window = asStated(sentencesNamingExitCode(section, code).join("\n"));
          return SHARED_ROOT_RESOLUTION_PHRASES.filter(
            (phrase) => !window.includes(asStated(phrase)),
          );
        });
    });
    expect(
      elsewhere.length,
      "the per-code read handed back the whole section",
    ).toBeGreaterThan(0);
  });
});

/**
 * The argv that carries each verb past its usage checks and into its own
 * work — the phase names are the fixture chain's one declared phase, since an
 * undeclared name is refused ahead of the work and would read as a verb that
 * cannot take the refusal under test.
 *
 * One table for the two describes that drive every verb over one deliberately
 * broken fixture — the write refusal below, and the resolution refusals past
 * it (`.claude/rules/engineering.md`, *A module is one job*). Both assert it
 * against the shipped command listing, so a verb the CLI gains and this table
 * has not reds rather than being skipped.
 */
const VERB_ARGV: Record<string, readonly string[]> = {
  status: ["status"],
  tick: ["tick"],
  loop: ["loop", "--max", "1"],
  wake: ["wake", "probe"],
  sleep: ["sleep", "probe"],
  hold: ["hold", "probe"],
  stop: ["stop"],
  log: ["log"],
  check: ["check"],
  render: ["render", "probe"],
  friction: ["friction"],
  // The one verb that runs something: a command that exits 0 and reads
  // nothing, so what either pass below observes is the verb's own
  // disposition over the denied root rather than the command's.
  exclusive: ["exclusive", "--", process.execPath, "-e", ""],
};

/**
 * CLI-VERB-PAGES-NAME-THE-STATE-ROOT-ACCESS-REFUSAL — the cause the resolution
 * causes above cannot cover: a root that stats as a directory, so every check
 * the resolution makes lets it through, and whose own state still will not
 * open. It is raised where the access fails (`StateRootAccessError`,
 * `src/stateRootAccess.ts`) and classified once at the CLI's process
 * boundary, so the verbs that can return it are exactly the verbs that reach
 * the baton or the stop flag — and no page named it at all, while the shared
 * clause's own doc called the three resolution causes every way a root comes
 * back unusable.
 *
 * Which verbs those are is **driven, never listed**: every verb the top-level
 * page names is run over one repository whose root is structurally denied, and
 * the ones that really exit `EX_IOERR` naming the resolved root are the scope
 * both cases below read (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*). A list here would be the tester's copy of a
 * dispatch order that moves whenever a verb grows an access.
 *
 * **Two denial passes, because one cannot reach every verb's first access.**
 * `stop`'s whole effect is the leaf `.flume/stop`, so nothing but a denial of
 * that leaf drives it here; and `loop` reads the same leaf as its stop flag
 * before it touches the baton, so that denial ends its run at exit `1`
 * ("stop flag present") ahead of the access it does take. The awake-flag
 * directory is denied in both passes — the deeper denial, and the one that
 * keeps every verb that would invoke an agent refusing ahead of one — while
 * the stop leaf is denied in the second alone. A verb's verdict is the union
 * over the two: it took the refusal in some pass, or it answered `0` in some
 * pass, and the verbs that answer `0` are the witness that this is not a
 * fixture refusing whatever it is handed (`.claude/rules/engineering.md`, *A
 * green verdict is proven non-vacuous*). Weakening the page equality instead
 * would let a verb that cannot be driven to its own refusal keep, or drop,
 * the row silently.
 *
 * What the scope keys on is the access refusal's own sentence, which only the
 * arm being documented prints, so a verb that failed for some other reason
 * cannot enter the scope — and one that fell out of it reds the page read
 * below rather than narrowing it silently.
 *
 * The lane this runs in is the one every merge pays (`vitest.config.ts`), so
 * the passes are still the cheapest shape that carries the claim: twenty
 * answers that never reach an agent.
 */
describe("the state-root access refusal, per verb (CLI-VERB-PAGES-NAME-THE-STATE-ROOT-ACCESS-REFUSAL)", () => {
  /** What the CLI prints when an access under the resolved root refused. */
  const accessRefusalOf = (stateRoot: string): string =>
    `state root at ${stateRoot} cannot be `;

  /** The verbs whose real process took that refusal, and the whole name set. */
  let refusing: string[];
  let names: string[];

  beforeAll(async () => {
    names = topLevelCommandNames();
    expect(
      Object.keys(VERB_ARGV).sort(),
      "the argv table and the shipped command list disagree",
    ).toEqual([...names].sort());

    const repo = await makeScratchRepo("flume-root-access-refusal-", "main");
    try {
      // `Chain.friction` declared, because a chain without it refuses that
      // verb at usage — ahead of every access — and would read as a verb
      // whose process cannot take this refusal.
      await writeRepoConfig(
        repo.dir,
        minimalChainSrc({ friction: "friction" }),
      );
      const stateRoot = join(repo.dir, STATE_ROOT_DIRNAME);
      const refusal = accessRefusalOf(stateRoot);

      // Denied by shape, on every host and for every uid: a plain file where
      // the baton wants a directory, and — in the second pass — a directory
      // where `stop`'s one leaf wants a file (`tests/helpers/denial.ts`).
      const took = new Set<string>();
      const answered = new Set<string>();
      for (const stopDenied of [false, true]) {
        denyDirectory(awakeDir(stateRoot));
        if (stopDenied) denyFile(stopFlagPath(stateRoot));
        for (const name of names) {
          const denied = await runCli(repo.dir, [...VERB_ARGV[name]!]);
          // `stop` is the one verb that can write its leaf in the first
          // pass; cleared here so no later verb in this pass reads a flag
          // an earlier one left, whatever order the shipped listing gives.
          if (!stopDenied) await rm(stopFlagPath(stateRoot), { force: true });
          if (denied.out.includes(refusal)) {
            // And it is this refusal reaching the operator as the documented
            // code, not as the raw-stack arm: the row a page spends on it is
            // the `74` row.
            expect(denied.code, denied.out).toBe(EX_IOERR);
            expect(denied.out).not.toContain("    at ");
            took.add(name);
          } else if (denied.code === 0) {
            answered.add(name);
          }
        }
      }
      // The fixture is live, and no verb is unaccounted for: one that
      // neither took the refusal in a pass nor answered over the denied root
      // in one is a verb this gate is silently not reading.
      for (const name of names) {
        expect(
          took.has(name) || answered.has(name),
          `flume ${name} neither took the access refusal nor answered over a denied root`,
        ).toBe(true);
      }
      refusing = names.filter((name) => took.has(name));
    } finally {
      await repo.cleanup();
    }
  });

  /** The `74` row of a verb's shipped `--help` page, as a phrase read sees it. */
  const rowOf = (name: string): string => {
    const page = helpPageFor(name);
    expect(page, `the help table answers no page for \`${name}\``).toBeDefined();
    const row = documentedExitCodeRows(page!).get(EX_IOERR);
    expect(row, `flume ${name} --help lists no ${EX_IOERR} row`).toBeDefined();
    return asStated(row!);
  };

  /** Whether a page's `74` row renders every cause the shared clause carries. */
  const rendersSharedClause = (name: string): boolean =>
    [...SHARED_ROOT_RESOLUTION_PHRASES, ROOT_ACCESS_PHRASE].every((phrase) =>
      rowOf(name).includes(asStated(phrase)),
    );

  it("every help page rendering the shared state-root clause states the access refusal among its 74 causes", () => {
    // Both directions of the scope, so neither a clause that reached every
    // page nor one that reached none reads as agreement.
    expect(refusing.length, "no verb took the access refusal").toBeGreaterThan(1);
    expect(
      refusing.length,
      "every verb took it — the verbs that reach none of the state are not a scope",
    ).toBeLessThan(names.length);

    // The pages that render the clause are exactly the verbs that can take
    // it. A page rendering it is therefore a page stating the write refusal,
    // which is what the next loop reads verbatim.
    expect(
      names.filter(rendersSharedClause).sort(),
      "the pages rendering the shared clause are not the verbs that take it",
    ).toEqual([...refusing].sort());

    for (const name of refusing) {
      expect(
        rowOf(name),
        `flume ${name} --help's ${EX_IOERR} row does not state the access refusal`,
      ).toContain(asStated(ROOT_ACCESS_PHRASE));
    }

    // And the converse the row owes a reader: a verb that answers and returns
    // ahead of the state under the root names no cause its own process cannot
    // return.
    for (const name of names.filter((name) => !refusing.includes(name))) {
      expect(
        rowOf(name),
        `flume ${name} --help states a refusal its process cannot take`,
      ).not.toContain(asStated(ROOT_ACCESS_PHRASE));
    }
  });

  it("docs/CLI.md states the state-root access refusal in every verb section whose 74 row renders it", async () => {
    expect(refusing.length, "no verb took the access refusal").toBeGreaterThan(1);
    const doc = await readCliDoc();

    for (const name of refusing) {
      // The producer's side first: the phrase is a span of the clause the
      // shipped row really renders, so the page is read against what an
      // operator running `--help` sees.
      expect(
        rowOf(name),
        `flume ${name} --help's ${EX_IOERR} row does not state the access refusal`,
      ).toContain(asStated(ROOT_ACCESS_PHRASE));

      const section = sectionOf(doc, new RegExp(`^## \`flume ${name}\\b`));
      expect(section.length, `docs/CLI.md has no \`flume ${name}\` section`).toBeGreaterThan(0);
      const window = asStated(sentencesNamingExitCode(section, EX_IOERR).join("\n"));
      expect(
        window.length,
        `docs/CLI.md's flume ${name} section spends no sentence on ${EX_IOERR}`,
      ).toBeGreaterThan(0);
      expect(
        window,
        `docs/CLI.md's flume ${name} section states no ${EX_IOERR} cause under the phrase the row renders`,
      ).toContain(asStated(ROOT_ACCESS_PHRASE));
    }

    // The window is scoped to this code rather than to the section: each of
    // these sections documents usage refusals too, so a reader handing back
    // the whole section could not tell a stated cause from a neighbouring one.
    const elsewhere = refusing.flatMap((name) => {
      const section = sectionOf(doc, new RegExp(`^## \`flume ${name}\\b`));
      return namedExitCodes(section)
        .filter((code) => code !== EX_IOERR)
        .filter(
          (code) =>
            !asStated(sentencesNamingExitCode(section, code).join("\n")).includes(
              asStated(ROOT_ACCESS_PHRASE),
            ),
        );
    });
    expect(
      elsewhere.length,
      "the per-code read handed back the whole section",
    ).toBeGreaterThan(0);
  });
});

/**
 * THE-VERB-PAGES-NAME-THE-ROOT-RESOLUTION-REFUSAL — the two refusals
 * state-root *resolution* takes, which are neither of the classes above: the
 * roots resolve fine and are the wrong pair, so the code is `2` rather than
 * `EX_IOERR`. Both are raised where the roots resolve
 * (`StateRootResolutionError`, `src/cliStateDirs.ts`) and classified at one
 * arm of the CLI's dispatch, ahead of every verb's own argument checks — and
 * no verb's page named either, while `flume status` documented no `2` row at
 * all and so stated a narrower range than its own process returns
 * (`spec/loop.md`, *Exit codes — the run never lies to CI*).
 *
 * **Driven, never listed**: every verb the top-level page names is run over
 * one repository against each refusal, and the code its real process returned
 * is what the rows below are read for (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*). Nothing here spells `2`: a
 * code re-routed between two arms moves the rows this reads with it.
 *
 * Each run carries the refusal's own sentence as its non-vacuity, so a verb
 * that failed for some other reason cannot be read as having taken it, and a
 * clean run over the same repository is the witness that this is not a
 * fixture refusing whatever it is handed. The refusals are environment-borne
 * and land before anything is published, so no run can change what a later
 * one sees.
 */
describe("the state-root resolution refusals, per verb (THE-VERB-PAGES-NAME-THE-ROOT-RESOLUTION-REFUSAL)", () => {
  /**
   * One refusal the resolution takes: what the inherited environment has to
   * carry for a verb to reach it, and the substring the CLI's own sentence
   * prints iff that refusal is the one it took.
   */
  interface RootResolutionRefusal {
    /** The refusal, named for a failure message. */
    readonly named: string;
    /** A substring the run prints iff it took this refusal and no other. */
    readonly evidence: string;
    /** What the run inherits, over the hermetic environment. */
    readonly env: (elsewhere: string) => NodeJS.ProcessEnv;
  }

  const ROOT_RESOLUTION_REFUSALS: readonly RootResolutionRefusal[] = [
    {
      named: "an inherited cross-repo FLUME_DIR_RESOLVED_FOR stamp",
      evidence: "refusing to write there",
      env: (elsewhere) => ({ FLUME_DIR_RESOLVED_FOR: elsewhere }),
    },
    {
      named: "a second state root in the checkout",
      evidence: "already holds flume state of its own",
      env: (elsewhere) => ({ FLUME_DIR: elsewhere }),
    },
  ];

  /** The codes each verb's real process returned, one per refusal, in order. */
  let took: Map<string, number[]>;
  /** What a verb over the same repository returns with neither refusal armed. */
  let clean: number;
  let names: string[];

  beforeAll(async () => {
    names = topLevelCommandNames();
    expect(
      Object.keys(VERB_ARGV).sort(),
      "the argv table and the shipped command list disagree",
    ).toEqual([...names].sort());

    const repo = await makeScratchRepo("flume-root-resolution-refusal-", "main");
    const elsewhere = await mkFixtureRoot("flume-root-resolution-elsewhere-");
    try {
      // `Chain.friction` declared, because a chain without it refuses that
      // verb at usage — and usage runs *after* the resolution, so a verb
      // refused there would still be reading this refusal's evidence. It is
      // declared anyway, so the clean run below is a clean run for every verb.
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      // The checkout holds flume state of its own, which is what the second
      // refusal collides with: a verdict log is a file, and presence is the
      // whole of what it carries (`checkoutStateRootArtifact`,
      // `src/cliStateDirs.ts`). An empty one leaves every verb's own reads
      // exactly as they were.
      await writeFile(
        tickVerdictsLogPath(join(repo.dir, STATE_ROOT_DIRNAME)),
        "",
        "utf8",
      );

      const observed = new Map<string, number[]>();
      for (const name of names) {
        const codes: number[] = [];
        for (const refusal of ROOT_RESOLUTION_REFUSALS) {
          const run = await runCli(repo.dir, [...VERB_ARGV[name]!], {
            ...hermeticEnv(),
            ...refusal.env(elsewhere),
          });
          // The arm, before its code counts: a verb that died on something
          // else exits some plausible status and would agree with a row
          // naming almost anything.
          expect(
            run.out,
            `flume ${name} under ${refusal.named} did not take that refusal`,
          ).toContain(refusal.evidence);
          // And it reached the operator as a sentence, not through the
          // raw-stack arm — which is the exit this row may not be.
          expect(run.out).not.toContain("    at ");
          codes.push(run.code);
        }
        observed.set(name, codes);
      }
      took = observed;

      // The fixture is live: the same repository, with neither refusal
      // armed, answers.
      const ordinary = await runCli(repo.dir, ["status"], hermeticEnv());
      expect(ordinary.out).toContain("pending:");
      clean = ordinary.code;
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
      await repo.cleanup();
    }
  });

  /** The row a verb's shipped page spends on `code`, as a phrase read sees it. */
  const rowOf = (name: string, code: number): string => {
    const page = helpPageFor(name);
    expect(page, `the help table answers no page for \`${name}\``).toBeDefined();
    const row = documentedExitCodeRows(page!).get(code);
    expect(row, `flume ${name} --help lists no ${code} row`).toBeDefined();
    return asStated(row!);
  };

  it("flume status --help names the exit code the state-root resolution refusals take", () => {
    const codes = took.get("status");
    expect(codes, "no `flume status` run was driven").toHaveLength(
      ROOT_RESOLUTION_REFUSALS.length,
    );
    // The code is the driven one in both directions: it is a status the verb
    // really returns, and it is not the status an unrefused run returns, so a
    // page naming the ordinary exit would not satisfy this.
    const listed = [...documentedExitCodes(helpPageFor("status")!)];
    for (const code of codes!) {
      expect(code, "a refused run answered as an ordinary one").not.toBe(clean);
      expect(
        listed,
        `flume status --help lists no ${code} row, and its process returns one`,
      ).toContain(code);
    }
    expect(listed, "the ordinary exit fell off the page").toContain(clean);
  });

  it("every verb's --help states both state-root resolution refusals among its exit-2 causes", () => {
    // Vacuity: an unparsed listing would hold every read below over zero
    // verbs, and the named one is the page that carried no such row at all.
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("status");
    // The clause's own arms, since the title claims both: a clause that lost
    // one would leave this green over the other.
    expect(ROOT_RESOLUTION_USAGE_PHRASES).toHaveLength(
      ROOT_RESOLUTION_REFUSALS.length,
    );

    for (const name of names) {
      const codes = took.get(name);
      expect(codes, `flume ${name} was not driven`).toHaveLength(
        ROOT_RESOLUTION_REFUSALS.length,
      );
      for (const [at, code] of codes!.entries()) {
        const phrase = ROOT_RESOLUTION_USAGE_PHRASES[at]!;
        expect(
          rowOf(name, code),
          `flume ${name} --help's ${code} row does not state ${ROOT_RESOLUTION_REFUSALS[at]!.named}`,
        ).toContain(asStated(phrase));
      }
    }
  });

  it("docs/CLI.md states both state-root resolution refusals in every verb section's window for the code they take", async () => {
    expect(names.length).toBeGreaterThan(1);
    const doc = await readCliDoc();

    for (const name of names) {
      const codes = took.get(name);
      expect(codes, `flume ${name} was not driven`).toHaveLength(
        ROOT_RESOLUTION_USAGE_PHRASES.length,
      );
      const section = sectionOf(doc, new RegExp(`^## \`flume ${name}\\b`));
      expect(
        section.length,
        `docs/CLI.md has no \`flume ${name}\` section`,
      ).toBeGreaterThan(0);

      for (const [at, code] of codes!.entries()) {
        const phrase = ROOT_RESOLUTION_USAGE_PHRASES[at]!;
        // The producer's side first: the phrase is a span of the clause the
        // shipped row really renders, so the page is read against what an
        // operator running `--help` sees.
        expect(rowOf(name, code)).toContain(asStated(phrase));

        const window = asStated(sentencesNamingExitCode(section, code).join("\n"));
        expect(
          window.length,
          `docs/CLI.md's flume ${name} section spends no sentence on ${code}`,
        ).toBeGreaterThan(0);
        expect(
          window,
          `docs/CLI.md's flume ${name} section states no ${code} cause under the phrase the row renders`,
        ).toContain(asStated(phrase));
      }
    }

    // The window is scoped to this code rather than to the section: each of
    // these sections documents refusals of other classes too, and those
    // sentences carry none of these causes, so a reader handing back the
    // whole section could not tell a stated cause from a neighbouring one.
    const taken = new Set([...took.values()].flat());
    const elsewhere = names.flatMap((name) => {
      const section = sectionOf(doc, new RegExp(`^## \`flume ${name}\\b`));
      return namedExitCodes(section)
        .filter((code) => !taken.has(code))
        .flatMap((code) => {
          const window = asStated(sentencesNamingExitCode(section, code).join("\n"));
          return ROOT_RESOLUTION_USAGE_PHRASES.filter(
            (phrase) => !window.includes(asStated(phrase)),
          );
        });
    });
    expect(
      elsewhere.length,
      "the per-code read handed back the whole section",
    ).toBeGreaterThan(0);
  });
});

/**
 * THE-COUNT-FLAG-REFUSAL-CLASS-IS-PINNED-AGAINST-ITS-PARSE — the class
 * `flume loop`'s `--max` and `flume log`'s `-n` refuse is hand-stated four
 * times: once in each verb's `--help` usage row, once in each verb's
 * `docs/CLI.md` section. `parseMaxValue` (`src/cliArgs.ts`) is what really
 * decides it, and nothing drove the parse over the class the four rows
 * enumerate — so a row naming a value the parse takes, or a parse widened
 * past what a row names, shipped green
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * The producer decides both sides. The rows are read off the shipped help
 * output and off `docs/CLI.md` as the working tree holds them, never
 * restated here; each arm's witness goes to the real parse rather than to a
 * copy of its regex. What this file holds is the join — the span each arm is
 * named under beside a value of it — which is the hand-authored input a
 * refusal case takes by that section's own scope, since no parse can produce
 * the class it rejects.
 *
 * Scoped by the rows that state the class rather than by a verb list here:
 * the lead is read off every shipped page, so a third verb taking a count
 * flag is pinned the tick its row states one.
 */
describe("the count flags' documented refusal class against the parse that decides it (THE-COUNT-FLAG-REFUSAL-CLASS-IS-PINNED-AGAINST-ITS-PARSE)", () => {
  /** Every `--help` exit-code row, on any page, that opens the class. */
  const statingRows = (): { verb: string; code: number; row: string }[] =>
    topLevelCommandNames().flatMap((verb) => {
      const page = helpPageFor(verb);
      if (page === undefined) return [];
      return [...documentedExitCodeRows(page)]
        .map(([code, row]) => ({ verb, code, row: asStated(row) }))
        .filter(({ row }) => row.includes(asStated(COUNT_FLAG_CLASS_LEAD)));
    });

  it("every count-flag refusal row names a value parseMaxValue refuses", async () => {
    const rows = statingRows();
    // Vacuity, and the direction the title claims: the class is copied per
    // verb, so a scope that collapsed to one page — or to none — would hold
    // every read below over a row it never compared.
    expect(rows.length, "no shipped --help row states the count-flag class").toBeGreaterThan(1);
    // Seven arms, as every surface stating the class enumerates them. A
    // table that lost one leaves the rows read over six and still green.
    expect(COUNT_FLAG_REFUSAL_PHRASES).toHaveLength(7);

    // The producer's side first: each arm's witness is refused where the
    // refusal is really decided, so a parse widened past a row reds here
    // before any prose is read.
    for (const { label, value } of NOT_A_DECIMAL_INTEGER) {
      expect(
        parseMaxValue(value),
        `parseMaxValue takes ${label}, which every count-flag row says it refuses`,
      ).toBeNull();
    }
    // And the parse still takes what the same rows say it takes, so the
    // refusals above are the class and not a parse that answers null for
    // everything.
    expect(parseMaxValue("50"), "parseMaxValue refuses a decimal integer").toBe(50);

    const doc = await readCliDoc();
    for (const { verb, code, row } of rows) {
      const section = sectionOf(doc, new RegExp(`^## \`flume ${verb}\\b`));
      expect(section.length, `docs/CLI.md has no \`flume ${verb}\` section`).toBeGreaterThan(0);
      const window = asStated(sentencesNamingExitCode(section, code).join("\n"));
      expect(
        window.length,
        `docs/CLI.md's flume ${verb} section spends no sentence on ${code}`,
      ).toBeGreaterThan(0);

      for (const phrase of COUNT_FLAG_REFUSAL_PHRASES) {
        expect(
          row,
          `flume ${verb} --help's ${code} row names no arm under "${phrase}"`,
        ).toContain(asStated(phrase));
        expect(
          window,
          `docs/CLI.md's flume ${verb} section states no ${code} cause under "${phrase}"`,
        ).toContain(asStated(phrase));
      }
    }
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
 * THE-MOUNT-DEAD-NARRATION-STATES-THE-RETIRED-ABORT — both surfaces an
 * operator reads before the hover text told them a child's mount-dead exit
 * ends the run outright, which is not what the supervisor decides: it
 * re-reads the mount at the tip and aborts only while one of the re-read's
 * legs still fails.
 *
 * Read against the legs the re-read really takes
 * (`MOUNT_DEAD_RE_READ_LEGS`, `src/loopSupervisor.ts`) — the help row
 * renders them and the page is checked against them, never against each
 * other, since two prose copies move together in the commit that changes the
 * behavior and agree while both are wrong
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
it("the loop help page's mount-dead row states the run aborts only while the mount is still dead", async () => {
  const legs = Object.values(MOUNT_DEAD_RE_READ_LEGS);
  // Non-vacuity: a re-read whose legs collapsed would leave every read below
  // holding over nothing, and the row could say anything.
  expect(legs.length).toBeGreaterThan(2);

  const { out, code } = await runCli(process.cwd(), ["loop", "--help"]);
  expect(code).toBe(0);
  const row = documentedExitCodeRows(out).get(EX_MOUNT_DEAD);
  expect(row, "the loop block lists no mount-dead row").toBeDefined();
  const stated = asStated(row!);

  // The claim, in the direction the supervisor decides it: the abort stands
  // only while a wall does, and the walls are the re-read's own legs.
  expect(stated).toContain("only while a wall still stands");
  for (const leg of legs) {
    expect(
      stated,
      `the mount-dead row does not name the re-read leg "${leg}"`,
    ).toContain(asStated(leg));
  }
  // And the other side of the condition reaches the operator on the same
  // row: a 69 the run goes on past.
  expect(stated).toContain("is that tick's error and nothing more");
  // Negative scoped to this one row — the retired spellings, which claimed
  // the abort unconditionally. Read against its own block rather than the
  // page, which quotes "wall" for the consecutive-failure backstop too
  // (`.claude/rules/posture-sweep.md`, *A negative assertion over a whole
  // rendered artifact*).
  expect(stated).not.toContain("either way the run aborts");
  expect(stated).not.toContain("against the same wall");
}, SPAWN_BUDGET_MS);

/**
 * The page half of the same drift. The code a declined 69 really leaves the
 * run exiting is driven through `loopExitCode` over the result such a run
 * reports rather than restated here, so the page's claim about the
 * non-abort is read against the classifier that decides it.
 */
it("docs/CLI.md's loop paragraph states a child's 69 the supervisor does not abort on", async () => {
  const legs = Object.values(MOUNT_DEAD_RE_READ_LEGS);
  expect(legs.length).toBeGreaterThan(2);

  // A run that spent its children on 69s the re-read declined to abort on:
  // every tick errored, nothing shipped, and `mountDead` unset — which is
  // exactly what distinguishes it from the abort below.
  const declined: SuperviseResult = {
    ticks: 2,
    hibernated: false,
    shippedTags: [],
    erroredTicks: [`tick exited ${EX_MOUNT_DEAD} (mount-dead)`],
    agentUsageByPhase: [],
  };
  const aborted: SuperviseResult = { ...declined, mountDead: true };
  // Non-vacuity in the shape that matters here: the two runs differ in code,
  // so the page is asserted to state the one the declined run really takes.
  expect(loopExitCode(aborted)).toBe(EX_MOUNT_DEAD);
  expect(loopExitCode(declined)).not.toBe(EX_MOUNT_DEAD);

  const section = sectionOf(await readCliDoc(), /^## `flume loop\b/);
  expect(section.length).toBeGreaterThan(0);
  // Scoped to the sentences that name 69 rather than the whole section: the
  // paragraph documents the verb's whole range, and a section-wide read
  // would turn on whatever the neighbouring arms quote.
  const window = asStated(
    sentencesNamingExitCode(section, EX_MOUNT_DEAD).join("\n"),
  );
  expect(
    window.length,
    `the loop section spends no sentence on ${EX_MOUNT_DEAD}`,
  ).toBeGreaterThan(0);

  for (const leg of legs) {
    expect(
      window,
      `the loop section's ${EX_MOUNT_DEAD} sentences do not name the re-read leg "${leg}"`,
    ).toContain(asStated(leg));
  }
  // The declined 69 itself: the run goes on, and the code it ends on is the
  // classifier's, not this page's to invent.
  expect(window).toContain("the run goes on");
  expect(window).toContain(`exits \`${loopExitCode(declined)}\``);
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
    const elsewhere = await mkFixtureRoot("flume-doc-status-other-repo-");
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
          // The spend line reads three artifacts — the history log, the
          // running ticks' rows files, the rendered prompts its in-flight
          // count is drawn from — so the verb names the subject and the
          // cause names the artifact and its path. The evidence reads both
          // halves, or an arm that refused over a different one of the three
          // would agree with this row.
          arm: "a tick-verdicts.jsonl the live run's spend line cannot read",
          evidence:
            "the live run's spend failed to read: " +
            "[flume] tick verdict history log is unreadable",
          run: () => {
            denyFile(tickVerdictsLogPath(flumeDir));
            return runCli(root, ["status"]);
          },
        },
        {
          // The resolution's own refusal, which `status` takes before it
          // observes anything: an inherited stamp naming another repository.
          // It lands ahead of every read above, so the denial that arm left
          // standing changes nothing about what this one answers.
          arm: "an inherited FLUME_DIR_RESOLVED_FOR stamp naming another repo",
          evidence: "refusing to write there",
          run: () =>
            runCli(root, ["status"], {
              ...hermeticEnv(),
              FLUME_DIR_RESOLVED_FOR: elsewhere,
            }),
        },
      ]);

      const section = sectionOf(await readCliDoc(), /^## `flume status\b/);
      expect(section.length).toBeGreaterThan(0);
      // Exactly the driven set, in both directions: a code the verb gained
      // and the page never named is red, and so is a code the page names
      // that no arm can produce.
      expect(namedExitCodes(section)).toEqual(driven);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
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
 * THE-RENDER-PAGE-NAMES-EVERY-CODE-IT-RETURNS — `docs/CLI.md` § `flume
 * render` is the third prose copy of a verb's exit-code range this page
 * carried with nothing reading it against the verb, and it had drifted in
 * the one way the page's own convention makes invisible: `65` and `69` were
 * stated trailing a sibling under one leading "Exits" (*Reading the exit
 * codes*), so the range its readers see was 0, 2 and 74 while the verb
 * returns five codes.
 *
 * Driven the way `status` and `log` are, and for the same reason: `render`
 * decides its code inside its own control flow rather than through a
 * classifier a candidate space can be run over, so the producer is the
 * **process** — one real `flume render` run per arm, against a fixture
 * built to reach it — and the section is compared to the set those runs
 * returned, never to the verb's `--help` block, which is the other prose
 * copy and moves with the page (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*).
 *
 * Both directions are asserted, one case each, because they are not the
 * same claim: the page understating its verb is what shipped here, while
 * the page naming a code the verb cannot return is the drift the other way.
 * The bound is {@link driveRunExitCodes}'s — a code reached by an arm
 * nobody wrote is invisible to either.
 */

/** A chain whose factory throws, for the mount-dead arm. */
const RENDER_DEAD_CHAIN_SRC =
  `export default () => { throw new Error("render chain factory exploded"); };\n`;

/** A prompt whose one inline-exec span exits non-zero, for the `EX_DATAERR` arm. */
const RENDER_UNRESOLVED_PROMPT =
  "before\n!`exit 7 # render-range-span-probe`\nafter\n";

/**
 * Every exit code a real `flume render` returns, ascending.
 *
 * Two repositories, because the arms are about two different things: four
 * are about the chain this verb resolves against, and the fifth is about
 * where the process was started — a bay whose `.flume` is present and
 * unstattable, below the fixture root's own, which is the discovery read
 * every verb makes before dispatch (`tests/cliStateDirs.test.ts` holds the
 * walk's side of that shape).
 */
async function driveRenderExitCodes(): Promise<number[]> {
  const repo = await makeScratchRepo("flume-doc-render-exits-", "main");
  const configDir = join(repo.dir, STATE_ROOT_DIRNAME);
  const walkup = await mkFixtureRoot("flume-doc-render-walkup-");
  const bay = join(walkup, "bay");
  const deep = join(bay, "src", "deep");
  try {
    return await driveRunExitCodes([
      {
        arm: "a prompt it resolved and printed",
        evidence: "probe prompt",
        run: async () => {
          await writeRepoConfig(repo.dir, minimalChainSrc());
          return runCli(repo.dir, ["render", "probe"]);
        },
      },
      {
        arm: "--entry against a phase that picks nothing",
        evidence: "picks no entry from the queue",
        run: () => runCli(repo.dir, ["render", "probe", "--entry", "ABSENT"]),
      },
      {
        arm: "an inline-exec span that exited non-zero",
        evidence: "render-range-span-probe",
        run: async () => {
          await writeFile(
            join(configDir, "prompts", "prompt.md"),
            RENDER_UNRESOLVED_PROMPT,
            "utf8",
          );
          return runCli(repo.dir, ["render", "probe"]);
        },
      },
      {
        // Last of the arms this repository carries: it replaces the chain
        // the three above resolve through, so each of them has already run
        // over the one that loads.
        arm: "a chain that will not load",
        evidence: "render chain factory exploded",
        run: async () => {
          await writeFile(
            join(configDir, "chain.ts"),
            RENDER_DEAD_CHAIN_SRC,
            "utf8",
          );
          return runCli(repo.dir, ["render", "probe"]);
        },
      },
      {
        arm: "a bay discovery that cannot stat the state root it meets",
        evidence: "failed to stat an ancestor bay",
        run: async () => {
          await mkdir(deep, { recursive: true });
          // ELOOP — present, unstattable. Not a permission bit: a root-run
          // lane would bypass that (`tests/helpers/denial.ts`).
          await symlink(STATE_ROOT_DIRNAME, join(bay, STATE_ROOT_DIRNAME));
          return runCli(deep, ["render", "probe"]);
        },
      },
    ]);
  } finally {
    await rm(walkup, { recursive: true, force: true });
    await repo.cleanup();
  }
}

/** The section both directions below read, with the cut's own emptiness pinned. */
async function renderSection(): Promise<string> {
  const section = sectionOf(await readCliDoc(), /^## `flume render\b/);
  expect(section.length).toBeGreaterThan(0);
  return section;
}

it("docs/CLI.md's flume render section names every exit code the verb returns", async () => {
  const driven = await driveRenderExitCodes();
  const named = namedExitCodes(await renderSection());
  // Vacuity: a section whose range was not read at all — a heading that
  // moved, a phrasing {@link namedExitCodes} no longer keys on — would hold
  // the membership below over the empty set.
  expect(named.length).toBeGreaterThan(1);

  const missing = driven.filter((code) => !named.includes(code));
  // What a red here means, in the page's own vocabulary: either the row is
  // missing outright, or it is stated where every reader of this page is
  // blind to it.
  expect(
    missing,
    `docs/CLI.md's flume render section names no exit ${missing.join(", ")} — ` +
      `either it lists no such row, or the row trails a sibling under one ` +
      `leading "Exits" instead of carrying its own introducing verb ("exits ` +
      `\`65\`"), the convention the page's intro states`,
  ).toEqual([]);
}, SPAWN_BUDGET_MS);

it("every exit code docs/CLI.md's flume render section names is one the verb really returns", async () => {
  const driven = await driveRenderExitCodes();
  const named = namedExitCodes(await renderSection());
  // Vacuity, as above: a section whose range was not read at all would hold
  // the membership below over the empty set, which no code can fail.
  expect(named.length).toBeGreaterThan(1);

  // Unlike the sections above, every backticked integer this one carries is
  // a code — it documents no `--max`-shaped default — so there is no
  // non-code denominator to assert beside this, and a value that drifted in
  // later would red here as a code the verb cannot return.
  expect(named.filter((code) => !driven.includes(code))).toEqual([]);
}, SPAWN_BUDGET_MS);

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
      await mkdir(join(dir, ".flume", "plan", "pending"), { recursive: true });
      await writeFile(
        join(dir, ".flume", "plan", "pending", entryFileName("DECLARES-FILES")),
        JSON.stringify({
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
        }) + "\n",
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

  /**
   * The page states the same backstop the help text does, and is the copy an
   * operator reads first — so it is read back against the same roster rather
   * than left to a hand-kept list the next member strands
   * (`.claude/rules/engineering.md`, *Derived state is computed, never
   * restated beside its source*).
   */
  it("docs/CLI.md's flume loop section names every FAILURE_STAGES member as an abort stage", async () => {
    const section = sectionOf(await readCliDoc(), /^## `flume loop\b/);
    expect(section.length).toBeGreaterThan(0);

    // Vacuity: the section states the backstop at all, and the roster it is
    // read against is populated, before any coverage is claimed over either.
    const prose = section.replace(/\s+/g, " ");
    expect(prose).toContain("abortThreshold");
    expect(FAILURE_STAGES.length).toBeGreaterThan(1);

    for (const stage of FAILURE_STAGES) {
      expect(
        prose,
        `docs/CLI.md's \`flume loop\` section names no ${stage}-stage wall`,
      ).toContain(`${stage}-stage`);
    }
  });
});

/**
 * HELP-ABORT-THRESHOLD-IS-OVERRIDABLE — both exit-1 surfaces stated the
 * consecutive-failure backstop as a fixed three ticks, which is wrong for any
 * chain declaring `supervisorPolicy.abortThreshold`
 * (`.claude/rules/engine-boundary.md`, "Routing rule (plan, build, and
 * interactive sessions)": a policy constant is an overridable default, never
 * fixed behavior). Help prints before any chain is resolved, so the surface
 * names the knob rather than rendering a run's value; the default it quotes is
 * interpolated from {@link DEFAULT_ABORT_THRESHOLD}, the same constant
 * `superviseLoop` falls back to, so the number cannot drift from the engine's
 * (`.claude/rules/engineering.md`, "Derived state is computed, never restated
 * beside its source").
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
    // and a baton wake writes into, so both are observable below.
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
      // load the chain and write a flag leaves both traces, so the empty bay
      // above is the short-circuit's doing rather than a fixture nothing
      // could have marked. `wake`, not `status`: reading the baton creates
      // nothing (`spec/loop.md`, *Baton — presence wakes, absence
      // hibernates*), so the directory is the first wake's.
      const woke = await runCliStreams(dir, ["wake", "probe"]);
      expect(woke.code).toBe(0);
      expect(woke.stderr).toContain("chain failed to load");
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
 * (spec/loop.md, *Exit codes — the run never lies to CI*). Four `--help`
 * pages — `wake`, `sleep`, `stop`, `render` — listed no 74 row at all, and
 * `docs/CLI.md`'s `check` section named the code nowhere, each understating
 * its own range.
 *
 * Both cases read the verb set off the surface rather than restating it —
 * `HELP_TOP`'s own `Commands:` block — so a verb added later is judged here
 * the tick it is added rather than the tick someone remembers to extend a
 * list, and a verb whose section drops the row reds however many others
 * still carry it.
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

  it("every verb's docs/CLI.md section names exit 74", async () => {
    const page = await readCliDoc();
    const names = topLevelCommandNames();
    // Vacuity: an unparsed listing would hold every read below over zero
    // verbs, and the named one is the section that stated its later codes
    // under one leading verb, where no reader on this page could see them.
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("friction");

    for (const verb of names) {
      // A verb the page gives no section of its own understates the row by
      // stating nothing, so it reds here rather than being skipped.
      const section = sectionOf(page, new RegExp(`^## \`flume ${verb}\\b`));
      expect(section.length, verb).toBeGreaterThan(0);

      // Vacuity, per verb: a section whose range was not read at all — a
      // heading that moved, a phrasing {@link namedExitCodes} no longer keys
      // on — would leave the membership beside it asserting over the empty
      // set.
      const codes = namedExitCodes(section);
      expect(codes.length, verb).toBeGreaterThan(1);
      // What a red here means, in the page's own vocabulary: either the row
      // is missing outright, or it is stated where {@link namedExitCodes} is
      // blind to it.
      expect(
        codes,
        `${verb}: docs/CLI.md's section names no exit ${EX_IOERR} — either it ` +
          `lists no such row, or the row trails a sibling under one leading ` +
          `"Exits" instead of carrying its own introducing verb ("exits ` +
          `${EX_IOERR}"), the convention the page's intro states`,
      ).toContain(EX_IOERR);
    }
  });
});

/*
 * CLI-DOC-CHECK-AND-STATUS-IO-REFUSALS-PINNED — `flume status`'s `docs/CLI.md`
 * section enumerated 74's *causes* without the discovery read every verb
 * starts with, and nothing already here reached that: a range pin compares
 * code sets, which a cause list is invisible to. The entry's other half —
 * `check`'s section naming no 74 at all — is the range read above, which asks
 * it of every verb the listing advertises rather than of a named few.
 *
 * `status` is pinned the way loop's cause list is — every arm driven for real,
 * one `flume status` run apiece, and the artifact each refusal reports read off
 * the run rather than spelled again by the tester's hand
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * The bound, declared rather than left implicit: an arm nobody wrote is
 * invisible here, exactly as it is for the driven loop and status/log ranges
 * above, and the claim is the one direction its title states — the page names
 * every artifact a driven refusal reports. A cause the page names that no arm
 * produces is out of this pin's sight, because two of status's five reads are
 * named in bare prose and the "no others" direction needs a vocabulary that
 * can tell a documented cause from a sentence about one.
 */

/**
 * How a refusal names the artifact it is about: the subject it leads with,
 * from the `[flume]` prefix through whatever the line says it could not do —
 * `loop lock at <path> failed to read`, `tick-verdicts.jsonl failed to read`,
 * `bay discovery from <cwd> failed to stat an ancestor bay`. Read off the
 * line rather than declared per arm, so a reworded refusal reds here instead
 * of being matched by a copy that moved with it.
 *
 * The stamp ahead of the prefix is required, not skipped: every refusal the
 * CLI writes is written through its stamped logger, whichever verb reaches it
 * and whether the subject is a bay this process discovered or an artifact the
 * verb went on to read (`spec/cli.md`, *A log line carries the instant it was
 * written*). So an unstamped refusal matches nothing here and reds on the arm
 * that drove it, instead of being read as a subject the page can be checked
 * against. Composed from the one home for that spelling
 * (`tests/helpers/stampedLine.ts`) rather than spelled again here.
 */
const REFUSAL_SUBJECT = new RegExp(
  String.raw`^${STAMP_SOURCE} \[flume\] (?:status: )?(.+?)(?: (?:at|from) \S+)? failed to (\w+)`,
);

/** Where one `flume status` refusal arm is armed. */
interface StatusFixture {
  /** The scratch repository the verb runs in. */
  readonly repoDir: string;
  /** Its state root. */
  readonly flumeDir: string;
  /** The tip claim for its HEAD ref, which lives outside that state root. */
  readonly claimPath: string;
}

/**
 * One start-up-to-spend-line I/O refusal `flume status` can take: the arm's
 * name for a failure message, the engine's filename for the artifact where
 * the state root holds one, and the run that arms the refusal and takes it.
 */
interface StatusIoRefusal {
  /** The arm, named for a failure message. */
  readonly arm: string;
  /**
   * The engine's own filename for the artifact, off the state root's table —
   * the second name a page may use where the refusal's subject is a phrase
   * (`loop lock` on stderr is `loop.pid` on the page). Absent for an artifact
   * the state root does not hold.
   */
  readonly fileName?: string;
  /**
   * Arm the refusal, run the verb over it, and leave the fixture as it was
   * found — the arms are ordered as the verb reaches them, so one left
   * standing refuses again and the arm behind it is never reached. Answers
   * the run and the path it denied, which the drive below reads the refusal
   * back against.
   */
  readonly drive: (
    fixture: StatusFixture,
  ) => Promise<{ out: string; code: number; denied: string }>;
}

/**
 * Every file `flume status` refuses over, in the order the verb reaches them:
 * the bay it is discovered through, that same bay obstructed under the baton
 * it constructs, the lock, the stop flag, the tip claim, and — under a live
 * supervisor alone — the verdict history its spend line totals.
 */
const STATUS_IO_REFUSALS: readonly StatusIoRefusal[] = [
  {
    arm: "a state root that will not stat at bay discovery",
    fileName: STATE_ROOT_DIRNAME,
    drive: async () => {
      // A root of its own: this arm's subject is a bay that cannot be
      // stat'd at all, and the shared fixture's has to stay readable for
      // every arm below it.
      const bay = await mkFixtureRoot("flume-doc-status-74-bay-");
      const denied = join(bay, STATE_ROOT_DIRNAME);
      try {
        // A self-referential link, as `tests/cli.test.ts` arms this same
        // read: ELOOP is the non-ENOENT stat failure, and a structural
        // denial (`tests/helpers/denial.ts`) cannot reach it — a directory
        // at the path is exactly what discovery is looking for.
        await rm(denied, { recursive: true, force: true });
        await symlink(STATE_ROOT_DIRNAME, denied);
        return { ...(await runCli(bay, ["status"])), denied };
      } finally {
        await rm(bay, { recursive: true, force: true });
      }
    },
  },
  {
    arm: "a state root that stats and is not a directory",
    fileName: STATE_ROOT_DIRNAME,
    drive: async () => {
      // A root of its own, for the reason the arm above gives, and denied
      // structurally rather than by a link: this arm's subject is a bay that
      // stats clean and cannot hold the baton's awake dir, which is a plain
      // file standing where the state root belongs. Discovery stops at it —
      // it is present — so the refusal is the verb's own, past discovery and
      // ahead of every read below.
      const bay = await mkFixtureRoot("flume-doc-status-74-obstructed-");
      const denied = join(bay, STATE_ROOT_DIRNAME);
      try {
        await rm(denied, { recursive: true, force: true });
        await writeFile(denied, "not a directory\n", "utf8");
        return { ...(await runCli(bay, ["status"])), denied };
      } finally {
        await rm(bay, { recursive: true, force: true });
      }
    },
  },
  {
    arm: "a loop lock that stats and will not open",
    fileName: STATE_ROOT_NAMES.loopLock,
    drive: async ({ repoDir, flumeDir }) => {
      const denied = loopLockPath(flumeDir);
      denyFile(denied);
      try {
        return { ...(await runCli(repoDir, ["status"])), denied };
      } finally {
        await rm(denied, { recursive: true, force: true });
      }
    },
  },
  {
    arm: "a stop flag that will not stat",
    fileName: STATE_ROOT_NAMES.stopFlag,
    drive: async ({ repoDir, flumeDir }) => {
      const denied = stopFlagPath(flumeDir);
      // ELOOP again, for the reason the bay arm states: this read is an
      // existence probe, and a directory at the path stats clean.
      await symlink(denied, denied);
      try {
        return { ...(await runCli(repoDir, ["status"])), denied };
      } finally {
        await rm(denied, { recursive: true, force: true });
      }
    },
  },
  {
    arm: "a tip claim that stats and will not open",
    drive: async ({ repoDir, claimPath }) => {
      await mkdir(dirname(claimPath), { recursive: true });
      denyFile(claimPath);
      try {
        return { ...(await runCli(repoDir, ["status"])), denied: claimPath };
      } finally {
        await rm(claimPath, { recursive: true, force: true });
      }
    },
  },
  {
    arm: "a verdict history the live run's spend line cannot read",
    fileName: STATE_ROOT_NAMES.tickVerdictsLog,
    drive: async ({ repoDir, flumeDir }) => {
      const lock = loopLockPath(flumeDir);
      const denied = tickVerdictsLogPath(flumeDir);
      // The spend line runs under a live supervisor alone, so this arm has
      // to plant one. The lock is composed by the real writer of that
      // statement (`renderPidClaim`, `src/pidClaim.ts`) rather than
      // hand-spelled — a hand copy would agree with a reader that had
      // changed.
      await writeFile(lock, renderPidClaim(process.pid, new Date()), "utf8");
      denyFile(denied);
      try {
        return { ...(await runCli(repoDir, ["status"])), denied };
      } finally {
        await rm(denied, { recursive: true, force: true });
        await rm(lock, { recursive: true, force: true });
      }
    },
  },
];

/**
 * Drive every arm above for real, one `flume status` run each, and answer the
 * names each refusal gave its artifact — the subject it printed, plus the
 * engine's filename for it where the state root holds one.
 *
 * A real repository on a named branch, because the last two arms sit past
 * reads that need one: the tip claim is keyed on HEAD's ref, and the spend
 * line is past the chain load a bare directory still reaches.
 *
 * Each arm pins its own non-vacuity: a run that never reached the read — a
 * refusal taken ahead of it, a denial armed at the wrong path — exits some
 * plausible code and would agree with prose naming almost anything, so the
 * run is asserted to have refused, and to have refused *over the path this
 * arm denied*, before its names count (`.claude/rules/engineering.md`, *A
 * green verdict is proven non-vacuous*).
 */
async function driveStatusIoRefusals(): Promise<string[][]> {
  const repo = await makeScratchRepo("flume-doc-status-74-", "main");
  const head = await currentRefPath(repo.dir);
  if (head.kind !== "ref") {
    throw new Error(`the fixture repository is not on a branch: ${head.kind}`);
  }
  const fixture: StatusFixture = {
    repoDir: repo.dir,
    flumeDir: join(repo.dir, ".flume"),
    claimPath: tipClaimPath(await gitCommonDir(repo.dir), head.path),
  };

  try {
    const stated: string[][] = [];
    for (const refusal of STATUS_IO_REFUSALS) {
      const { out, code, denied } = await refusal.drive(fixture);
      expect(code, refusal.arm).toBe(EX_IOERR);

      // The refusal is the last thing the verb writes before it returns, and
      // stderr trails stdout in the combined output, so it is the last line —
      // which is what tells it from the chain-load report `status` prints
      // ahead of its own reads on a fixture carrying no chain.
      const line = out.trimEnd().split("\n").at(-1) ?? "";
      const subject = REFUSAL_SUBJECT.exec(line);
      expect(subject, `${refusal.arm}: ${line}`).not.toBeNull();
      // And it is *this* arm's refusal: the artifact it names is the one this
      // arm denied, by the name the engine's own accessor gave that path.
      expect(line, refusal.arm).toContain(basename(denied));

      stated.push([
        subject![1]!,
        ...(refusal.fileName === undefined ? [] : [refusal.fileName]),
      ]);
    }
    return stated;
  } finally {
    await repo.cleanup();
  }
}

describe("docs/CLI.md's status I/O refusal causes (CLI-DOC-CHECK-AND-STATUS-IO-REFUSALS-PINNED)", () => {
  it("docs/CLI.md's flume status section names every artifact a real status I/O refusal reports", async () => {
    const stated = await driveStatusIoRefusals();
    // Vacuity: one arm that happened to fire agrees with a sentence naming
    // one cause, whichever it is — and two arms that took the same refusal
    // would count twice while covering one read, which distinct subjects is
    // what rules out.
    expect(stated.length).toBe(STATUS_IO_REFUSALS.length);
    expect(stated.length).toBeGreaterThan(1);
    expect(new Set(stated.map((names) => names[0])).size).toBe(stated.length);

    const section = sectionOf(await readCliDoc(), /^## `flume status\b/);
    expect(section.length).toBeGreaterThan(0);
    const ioWindow = sentencesNamingExitCode(section, EX_IOERR).join("\n");

    // The window is scoped to this code rather than to the section: `status`
    // spends most of its section on the listing it prints, naming artifacts
    // no refusal is about, so a reader handing back the whole section would
    // pass over a 74 sentence that had gone silent.
    const outside = artifactsNamedIn(section).filter(
      (name) => !artifactsNamedIn(ioWindow).includes(name),
    );
    expect(
      outside.length,
      "the 74 window read back the whole section",
    ).toBeGreaterThan(0);

    // Each artifact by one of the two names the engine has for it — the
    // subject its refusal printed, or the state root's own filename, since
    // the page spells `loop.pid` where the refusal says "loop lock".
    const unnamed = stated.filter(
      (names) => !names.some((name) => ioWindow.includes(name)),
    );
    expect(unnamed, "artifacts the 74 sentence does not name").toEqual([]);
  }, SPAWN_BUDGET_MS);
});

/**
 * THE-RENDER-REFUSED-CLASS-IS-ENUMERATED-WHOLE — three shipped surfaces name
 * the `render-refused` class and then enumerate its members: the `65` row of
 * `flume render --help`, the same code's sentence in `docs/CLI.md`, and the
 * no-commit taxonomy's bullet in `docs/CHAIN-AUTHORING.md`. Each listed two
 * of the three, dropping the `{{KEY}}` no arg filled — the drift three hand
 * copies of one enumeration produce, since a copy that names the class reads
 * as complete whatever it left out.
 *
 * The phrases are not hand-spelled here: they come from the roster the
 * shipped help row renders from (`RENDER_REFUSED_PHRASES`, `src/cliHelp.ts`),
 * which is the one home the members have now, so a member the class gains
 * reds every page that did not gain it (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*). The class the roster
 * enumerates is the one the verb really refuses on: `tests/cliRender.test.ts`
 * drives each member to a real `EX_DATAERR`.
 *
 * Two rosters, because the class has two widths. `flume render` renders a
 * prompt and never consults `phase.shouldRun`, so its `65` row and
 * `docs/CLI.md`'s sentence state three; a tick consults that hook and records
 * a throw under the same mode, so the taxonomy `docs/CHAIN-AUTHORING.md`
 * documents to a chain author states four and is read against
 * `TICK_RENDER_REFUSED_PHRASES` — the verb's roster composed with that one
 * member, not respelled beside it. The bullet's fourth member was
 * hand-spelled against the verb's three and held by nothing until then.
 */
describe("the render-refused class, enumerated whole wherever it is named (THE-RENDER-REFUSED-CLASS-IS-ENUMERATED-WHOLE)", () => {
  /**
   * Non-vacuity for all three cases, asserted once: the roster really carries
   * more than the pair the pages used to name, and no member's phrase is a
   * span of another's — a "names every member" read over a roster whose
   * phrases nest would pass on the one page that named the longest.
   */
  it("the render-refused roster carries three members no one of which states another", () => {
    expect(RENDER_REFUSED_PHRASES.length).toBe(3);
    const stated = RENDER_REFUSED_PHRASES.map(asStated);
    expect(new Set(stated).size).toBe(stated.length);
    const nested = stated.filter((phrase) =>
      stated.some((other) => other !== phrase && other.includes(phrase)),
    );
    expect(nested, "a member's phrase is a span of another's").toEqual([]);
  });

  /**
   * The tick's roster is the verb's plus the hook the verb never consults,
   * and it is composed rather than respelled — so this reads membership by
   * identity against the verb's own array, never against a second spelling of
   * its phrases. The same non-vacuity and nesting pins ride the wider set,
   * since the bullet read below is one `toContain` per phrase.
   */
  it("the tick's render-refused roster carries the render verb's members and the shouldRun refusal beside them", () => {
    expect(RENDER_REFUSED_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of RENDER_REFUSED_PHRASES) {
      expect(
        TICK_RENDER_REFUSED_PHRASES,
        `the tick's roster drops the verb's ${phrase}`,
      ).toContain(phrase);
    }

    const beyond = TICK_RENDER_REFUSED_PHRASES.filter(
      (phrase) => !RENDER_REFUSED_PHRASES.includes(phrase),
    );
    expect(beyond, "the tick's roster is the verb's, unwidened").toHaveLength(
      1,
    );
    // The member by the hook it belongs to, not by its whole sentence: the
    // spelling is the roster's to own, and the pages are read against it.
    expect(asStated(beyond[0] ?? "")).toContain("`shouldrun`");
    expect(asStated(beyond[0] ?? "")).toContain("threw");

    const stated = TICK_RENDER_REFUSED_PHRASES.map(asStated);
    expect(new Set(stated).size).toBe(stated.length);
    const nested = stated.filter((phrase) =>
      stated.some((other) => other !== phrase && other.includes(phrase)),
    );
    expect(nested, "a member's phrase is a span of another's").toEqual([]);
  });

  it("flume render --help names every member of the render-refused class", async () => {
    const { out, code } = await runCli(process.cwd(), ["render", "--help"]);
    expect(code).toBe(0);
    // The window is the `65` row alone rather than the page: the block above
    // it states the chain-load refusals and the one below the mount-dead
    // ones, and a read over the whole page would pass over a row that had
    // gone silent (`.claude/rules/posture-sweep.md`, *A negative assertion
    // over a whole rendered artifact*).
    const opened = out.indexOf("\n  65  ");
    const closed = out.indexOf("\n  69  ");
    expect(opened, "the render page spends no row on 65").toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(opened);
    const row = asStated(out.slice(opened, closed));
    for (const phrase of RENDER_REFUSED_PHRASES) {
      expect(row, `the 65 row does not name ${phrase}`).toContain(
        asStated(phrase),
      );
    }
  }, SPAWN_BUDGET_MS);

  it("docs/CLI.md's flume render section names every member of the render-refused class", async () => {
    const section = sectionOf(await readCliDoc(), /^## `flume render\b/);
    expect(section.length).toBeGreaterThan(0);
    const window = asStated(
      sentencesNamingExitCode(section, EX_DATAERR).join("\n"),
    );
    expect(window.length, "the section spends no sentence on 65").toBeGreaterThan(0);
    for (const phrase of RENDER_REFUSED_PHRASES) {
      expect(window, `the 65 sentence does not name ${phrase}`).toContain(
        asStated(phrase),
      );
    }
    // Scoped to the code, not the section: the verb's other exit codes are
    // documented in the same paragraph, and a window that read them back
    // would carry their prose into this claim.
    expect(
      asStated(section).length,
      "the 65 window read back the whole section",
    ).toBeGreaterThan(window.length);
  });

  it("docs/CHAIN-AUTHORING.md's render-refused bullet names every member of the tick's class", async () => {
    const page = await readFile(
      fileURLToPath(new URL("../docs/CHAIN-AUTHORING.md", import.meta.url)),
      "utf8",
    );
    // The bullet, not the page: the taxonomy's siblings quote the render
    // vocabulary too — `clean-exit` names the agent's own message and
    // `platform-preempt` the invocation — so a page-wide read would pass over
    // a bullet that had gone silent.
    const bullet = asStated(bulletOf(page, "- `render-refused` — "));
    expect(bullet.length).toBeGreaterThan(0);
    expect(asStated(page).length).toBeGreaterThan(bullet.length);
    // The tick's roster, not the verb's: this bullet documents what a tick
    // records, and a tick reaches one member `flume render` cannot.
    expect(TICK_RENDER_REFUSED_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of TICK_RENDER_REFUSED_PHRASES) {
      expect(bullet, `the bullet does not name ${phrase}`).toContain(
        asStated(phrase),
      );
    }
  });

  /**
   * The same width again, one surface over from the bullet: `TickOutcome`
   * ships from `src/index.ts`, so its `noCommit` block is the hover text a
   * chain author reads before reaching any page. That block enumerated two of
   * the four a tick records — a third spelling of the roster, held by
   * nothing — so it is read against the array the bullet is, and a member
   * either roster gains reaches it too.
   */
  it("TickOutcome.noCommit's render-refused line names every member of the tick's class", () => {
    const doc = docProse(docCommentFor(srcText("Dispatcher.ts"), "noCommit"));
    // The bullet, not the block: its siblings quote the render vocabulary too
    // — `clean-exit` names the agent's own message, and the precedence
    // sentence below names the mode outright — so a block-wide read would
    // pass over a bullet that had gone silent
    // (`.claude/rules/posture-sweep.md`, *A negative assertion over a whole
    // rendered artifact*).
    const opened = doc.indexOf("- `render-refused`");
    const closed = doc.indexOf("Absent when", opened);
    expect(
      opened,
      "the block spends no bullet on render-refused",
    ).toBeGreaterThan(-1);
    expect(closed, "the bullet runs to the end of the block").toBeGreaterThan(
      opened,
    );
    const bullet = asStated(doc.slice(opened, closed));
    expect(asStated(doc).length).toBeGreaterThan(bullet.length);

    // The tick's roster, not the verb's: this field records what a tick
    // produced, and a tick reaches one member `flume render` cannot.
    expect(TICK_RENDER_REFUSED_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of TICK_RENDER_REFUSED_PHRASES) {
      expect(bullet, `the bullet does not name ${phrase}`).toContain(
        asStated(phrase),
      );
    }
  });
});
