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
 * outcomes that are not a refusal; the other three each name what was wrong
 * and leave in `lines` the evidence for it.
 *
 * `empty` is its own outcome rather than a green one: a judge whose input set
 * collapsed to zero proved nothing, and reporting that as green is the false
 * pass that hides longest (`.claude/rules/engineering.md`, *A green verdict
 * is proven non-vacuous*). What an entry naming no line should cost is the
 * caller's policy, not the judge's.
 */
export type JudgeOutcome =
  | "proven"
  | "empty"
  | "unnamed"
  | "green-on-base"
  | "suite-failed";

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
  /** The run-relative files those failures were attributed to, deduplicated. */
  readonly failingFiles: readonly string[];
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
 */
export async function judgeNamedLines(
  runner: Runner,
  request: JudgeRequest,
): Promise<JudgeVerdict> {
  const { tests, pins, baseSha, cwd } = request;
  const named = [...tests, ...pins];

  const run = await runner.run(named, cwd);
  /** The merged-tree facts every verdict below carries, whatever it rules. */
  const observed = {
    passed: run.passed,
    failures: run.failures,
    failingFiles: run.failingFiles,
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
    const first = run.failures[0];
    return {
      outcome: "suite-failed",
      message:
        `the suite is not green: ${run.failures.length} failure(s)` +
        (first ? `, first ${first.file}${first.name ? ` × ${first.name}` : ""}` : ""),
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
