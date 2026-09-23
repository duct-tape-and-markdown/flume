/**
 * The judges (`spec/harness.md`, *The judges*) — the harness package's
 * ruling on an entry's named lines: every `tests[]` line green on the merged
 * tree and red at the base, every `pins[]` line green only.
 *
 * Acceptance-driven backpressure is the whole point. Plan names a behavior,
 * build titles a passing test with the line verbatim, and this judge proves
 * the name has a test rather than trusting a commit body. The base half
 * proves the test pins something the entry changed: a `tests[]` line that
 * already passed before the work names a behavior the entry did not
 * introduce.
 *
 * Every observation reaches the judge through the runner interface
 * (`runner.ts`), so nothing here knows which tool ran — no report is parsed,
 * no exit code is read, no test file is named. A consumer running cargo or a
 * shell script gets the same ruling from the same code.
 *
 * The judge **reports**; it does not act. A `tests[]` line found green at the
 * base is a fact on the verdict under its own outcome and its own line state,
 * not a sentence a caller has to pattern-match out of a message
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*) — the line is plan's to move, and a caller that can
 * see which line it was can say so.
 */

import type { NamedResult, RunResult, Runner, TestFailure } from "./runner.js";

/** Which of the entry's two lists a line came from, and so which bar it faces. */
export type LineLane = "tests" | "pins";

/**
 * What the judge found for one line.
 *
 * - `proven` — the line met its lane's bar in full: a `pins[]` line carried
 *   on the merged tree, or a `tests[]` line carried there and absent at the
 *   base.
 * - `carried` — a passing test carried the line on the merged tree, and the
 *   base run a `tests[]` line still needs did not happen because an earlier
 *   refusal preempted it. Never the state of a `pins[]` line, which the
 *   merged tree settles.
 * - `unnamed` — no passing test's full name contained the line.
 * - `green-on-base` — a `tests[]` line carried on the merged tree and carried
 *   again at the base. The line pins nothing this entry changed.
 */
export type LineState = "proven" | "carried" | "unnamed" | "green-on-base";

/** One line's verdict, and the files that decided it. */
export interface LineVerdict {
  /** The line, verbatim as the entry declared it. */
  readonly line: string;
  /** The list it came from. */
  readonly lane: LineLane;
  /** What the judge found. */
  readonly state: LineState;
  /**
   * The run-relative files whose passing tests carried the line on the merged
   * tree. Empty exactly when `state` is `unnamed`.
   */
  readonly files: readonly string[];
}

/**
 * The judge's ruling over the whole entry. `proven` and `empty` are the two
 * outcomes that are not a refusal; the other four each name what was wrong
 * and leave in `lines` the evidence for it.
 *
 * `empty` is its own outcome rather than a green one: a judge whose input set
 * collapsed to zero proved nothing, and reporting that as green is the false
 * pass that hides longest (`.claude/rules/engineering.md`, *A green verdict
 * is proven non-vacuous*). What an entry naming no line should cost is the
 * caller's policy, not the judge's.
 *
 * `base-red` and `suite-failed` are the same red suite told apart by one
 * observation: whether the failures were already there at the span's base.
 * Both are refusals — an entry is unjudgeable on a red tree either way — and
 * which of them a caller blames the span for is the caller's
 * (`.claude/rules/engine-boundary.md`, *Routing rule (plan, build, and
 * interactive sessions)*).
 */
export type JudgeOutcome =
  | "proven"
  | "empty"
  | "unnamed"
  | "green-on-base"
  | "suite-failed"
  | "base-red";

/** What the judge ruled, and every fact it ruled from. */
export interface JudgeVerdict {
  /** The ruling. */
  readonly outcome: JudgeOutcome;
  /** One line, for a log or a gate message. The facts below are the surface. */
  readonly message: string;
  /**
   * One verdict per declared line, `tests[]` first then `pins[]`, in declared
   * order. Empty exactly when the entry named no line.
   */
  readonly lines: readonly LineVerdict[];
  /** How many tests passed on the merged tree — the caller's vacuity check. */
  readonly passed: number;
  /** Every failure the merged-tree run reported, in report order. */
  readonly failures: readonly TestFailure[];
  /**
   * The run-relative files those failures were attributed to, deduplicated
   * in report order. Derived here from {@link failures} rather than asked of
   * the runner, so the blame list cannot disagree with the failures it
   * summarizes.
   */
  readonly failingFiles: readonly string[];
  /**
   * The subset of {@link failingFiles} the span itself changed — read against
   * {@link JudgeRequest.footprint}, which the verdict does not restate. A
   * failure in one of these is the span's however the base ran, so the base
   * is not asked about it.
   *
   * Empty over a green suite, and empty over a red suite whose every failing
   * file the span never touched — the case that sends those files to the base.
   */
  readonly ownFailingFiles: readonly string[];
  /**
   * Every failure the base run over {@link failingFiles} reported, in report
   * order. That run happens exactly when the suite is red, `failingFiles` is
   * populated, and {@link ownFailingFiles} is empty, so whether it happened
   * is read off those rather than off a fourth field restating them
   * (`.claude/rules/engineering.md`, *Derived state is computed, never
   * restated beside its source*).
   *
   * Non-empty is the `base-red` outcome: the suite was failing before this
   * span existed.
   */
  readonly baseFailures: readonly TestFailure[];
}

/** What the judge is asked to rule on. */
export interface JudgeRequest {
  /** The entry's `tests[]`: green on the merged tree, red at the base. */
  readonly tests: readonly string[];
  /** The entry's `pins[]`: green on the merged tree, never run at the base. */
  readonly pins: readonly string[];
  /**
   * The commit the merged tree is judged against. Required rather than
   * optional: a judge handed no base cannot rule on a `tests[]` line, and a
   * caller that has no base sha resolves that before it gets here.
   */
  readonly baseSha: string;
  /**
   * The gated span's changed paths, in git's own alphabet — a gate hands over
   * `GateContext.touchedPaths`, which the dispatcher already computed. It is
   * the only value that tells a failure the span caused from one it merely
   * inherited, so it is required for the same reason {@link baseSha} is: a
   * caller with no footprint has no span, and a judge handed none would read
   * every red suite as the span's.
   */
  readonly footprint: readonly string[];
  /** The tree to run in. */
  readonly cwd: string;
}

/**
 * The runner's answer for one requested name. A runner that answers fewer
 * names than it was asked about has broken its contract, and the missing
 * answer would otherwise read as a line no test carried — a refusal pinned
 * on build for the runner's defect (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
function answerFor(run: RunResult, name: string, where: string): NamedResult {
  const answer = run.names.find((n) => n.name === name);
  if (!answer) {
    throw new Error(
      `the runner reported no result for the named line ${JSON.stringify(name)} ` +
        `(${where}). A runner answers every name it was asked about ` +
        `(spec/harness.md, The runner interface).`,
    );
  }
  return answer;
}

const quote = (lines: readonly LineVerdict[]): string =>
  lines.map((l) => JSON.stringify(l.line)).join(", ");

/** The clause a failure list contributes to a message: its first, or nothing. */
const firstOf = (failures: readonly TestFailure[]): string => {
  const first = failures[0];
  return first ? `, first ${first.file}${first.name ? ` × ${first.name}` : ""}` : "";
};

/**
 * Judge one entry's named lines through a declared runner.
 *
 * The merged-tree run happens once and carries both lanes, because it is the
 * consumer's whole suite either way. The base run happens only when a
 * `tests[]` line survived to need it, and only the `tests[]` lines are asked
 * about there — a `pins[]` line names a property that was already true, so
 * asking whether it holds at the base is asking a question whose answer
 * changes nothing.
 *
 * A base run that fails is not a problem: red is the expectation there, and a
 * file that cannot even load at the base (it imports a symbol the entry
 * introduced) carries no passing test and so reads red — conservative in the
 * direction that matters.
 *
 * A **red merged suite** reaches the base too, and for the opposite question:
 * whether it was red before this span existed. That question is asked only
 * when *no* failing file is in the span's footprint, and then over all of
 * them, through the same `runAtBase` — the overlay it lays down is the
 * working tree's copy of a file the span never changed, so the base's own
 * verdict is what runs. One failing file the span *did* touch settles the
 * blame here and spends no base run: that overlay would carry the span's own
 * breakage to the base and report it back as the base's.
 */
export async function judgeNamedLines(
  runner: Runner,
  request: JudgeRequest,
): Promise<JudgeVerdict> {
  const { tests, pins, baseSha, footprint, cwd } = request;
  const named = [...tests, ...pins];
  const spanFiles = new Set(footprint);

  const run = await runner.run(named, cwd);
  const failingFiles = [...new Set(run.failures.map((f) => f.file))];
  /** The merged-tree facts every verdict below carries, whatever it rules. */
  const observed = {
    passed: run.passed,
    failures: run.failures,
    failingFiles,
    ownFailingFiles: failingFiles.filter((file) => spanFiles.has(file)),
    baseFailures: [] as readonly TestFailure[],
  };

  const draft = (line: string, lane: LineLane): LineVerdict => {
    const answer = answerFor(run, line, `the run in ${cwd}`);
    return {
      line,
      lane,
      state: answer.carried ? (lane === "pins" ? "proven" : "carried") : "unnamed",
      files: answer.files,
    };
  };
  const lines: LineVerdict[] = [
    ...tests.map((line) => draft(line, "tests")),
    ...pins.map((line) => draft(line, "pins")),
  ];

  if (!run.ok) {
    const short = baseSha.slice(0, 7);
    // Every failing file is one the span never touched, so the base can be
    // asked whether they were failing already. One file the span *did* touch
    // settles the blame here, and no base run is spent.
    const askBase = failingFiles.length > 0 && observed.ownFailingFiles.length === 0;
    const baseFailures = askBase
      ? (await runner.runAtBase([], failingFiles, baseSha, cwd)).failures
      : [];

    if (baseFailures.length > 0) {
      return {
        outcome: "base-red",
        message:
          `the suite was already red at ${short}: ${baseFailures.length} failure(s) there ` +
          `across ${failingFiles.length} file(s) this span never touched` +
          firstOf(baseFailures),
        lines,
        ...observed,
        baseFailures,
      };
    }

    return {
      outcome: "suite-failed",
      message:
        `the suite is not green: ${run.failures.length} failure(s)` +
        firstOf(run.failures) +
        (askBase ? `; green at ${short}, so the failure arrived with this span` : ""),
      lines,
      ...observed,
    };
  }

  if (named.length === 0) {
    return {
      outcome: "empty",
      message: `the suite is green (${run.passed} passed) and the entry named no line — nothing judged`,
      lines,
      ...observed,
    };
  }

  const unnamed = lines.filter((l) => l.state === "unnamed");
  if (unnamed.length > 0) {
    return {
      outcome: "unnamed",
      message:
        `${unnamed.length} of ${named.length} named line(s) have no passing test: ${quote(unnamed)} ` +
        `— title a passing test with each line verbatim`,
      lines,
      ...observed,
    };
  }

  if (tests.length === 0) {
    return {
      outcome: "proven",
      message: `${pins.length} pins[] line(s) green (${run.passed} passed); no tests[] line to run at the base`,
      lines,
      ...observed,
    };
  }

  const files = [...new Set(lines.filter((l) => l.lane === "tests").flatMap((l) => l.files))];
  if (files.length === 0) {
    throw new Error(
      `the runner reported ${tests.length} carried tests[] line(s) and no file holding them, ` +
        `so there is nothing to lay over the base (spec/harness.md, The runner interface).`,
    );
  }

  const atBase = await runner.runAtBase(tests, files, baseSha, cwd);
  const ruled = lines.map((l): LineVerdict => {
    if (l.lane !== "tests") return l;
    const carried = answerFor(atBase, l.line, `the base run at ${baseSha}`).carried;
    return { ...l, state: carried ? "green-on-base" : "proven" };
  });

  const greenOnBase = ruled.filter((l) => l.state === "green-on-base");
  if (greenOnBase.length > 0) {
    return {
      outcome: "green-on-base",
      message:
        `${greenOnBase.length} of ${tests.length} tests[] line(s) already pass at ` +
        `${baseSha.slice(0, 7)}: ${quote(greenOnBase)} — each names a behavior the entry did not introduce`,
      lines: ruled,
      ...observed,
    };
  }

  return {
    outcome: "proven",
    message:
      `${tests.length} tests[] line(s) green (${run.passed} passed) and red at ${baseSha.slice(0, 7)}` +
      (pins.length > 0 ? `; ${pins.length} pins[] line(s) green` : ""),
    lines: ruled,
    ...observed,
  };
}
