/**
 * The judges (`spec/harness.md`, *The judges*) — the harness package's
 * ruling on an entry's named lines: every `tests[]` line green on the merged
 * tree and red at the base, every `pins[]` line green only, every
 * `laneTests[]` line owed to the CI lane that runs it.
 *
 * Acceptance-driven backpressure is the whole point. Plan names a behavior,
 * build titles a passing test with the line verbatim, and this judge proves
 * the name has a test rather than trusting a commit body. The base half
 * proves the test pins something the entry changed: a `tests[]` line that
 * already passed before the work names a behavior the entry did not
 * introduce.
 *
 * It accepts a **batch**: the spans one merge carried, each with its own
 * base. The suite runs once over the merged tree — it is the consumer's whole
 * suite whatever the merge carried — and the base half builds one tree per
 * distinct base, so an entry is never proved against a sibling's starting
 * point. A single span is a batch of one, and no arm below branches on which
 * it was handed.
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

import type { LaneTest } from "./entryExtension.js";
import type { NamedResult, RunResult, Runner, TestFailure } from "./runner.js";

/**
 * Which of the entry's three lists a line came from, and so which bar it
 * faces. `laneTests` is the host-gated one: its bar is met on another host
 * entirely, so this judge only ever reports it owed there.
 */
export type LineLane = "tests" | "pins" | "laneTests";

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
 * - `owed` — a `laneTests[]` line whose case exists here and did not run
 *   here, or ran and passed: either way the line is owed to the CI lane
 *   {@link LineVerdict.owedTo} names, which is the only place its behavior is
 *   actually proven. Never `proven`, because this host proved nothing about
 *   it (`.claude/rules/engineering.md`, *A green verdict is proven
 *   non-vacuous*).
 * - `unnamed` — no test's full name contained the line: no passing one, and
 *   for a `laneTests[]` line no skipped one either. A host-gated case has to
 *   exist in the suite to be owed anywhere.
 * - `green-on-base` — a `tests[]` line carried on the merged tree and carried
 *   again at the base. The line pins nothing this entry changed.
 */
export type LineState =
  | "proven"
  | "carried"
  | "owed"
  | "unnamed"
  | "green-on-base";

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
   * tree. Empty when `state` is `unnamed`, and empty for the ordinary `owed`
   * line too — a skipped case names no file, and none of its bytes is laid
   * over a base.
   */
  readonly files: readonly string[];
  /**
   * The CI lane a `laneTests[]` line is owed to, as the entry declared it —
   * absent on every other line. Reported rather than left for a caller to
   * re-join against the request: the lane is what a reader has to act on,
   * and the verdict is the surface it reads
   * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   * never rediscovered*).
   */
  readonly owedTo?: string;
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
   * One verdict per declared line — `tests[]`, then `pins[]`, then
   * `laneTests[]` — in declared order. Empty exactly when the entry named no
   * line.
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
   * The subset of {@link failingFiles} the merge's own spans changed — read
   * against the union of every {@link JudgeSpan.footprint}, which the verdict
   * does not restate. A failure in one of these is the merge's however the
   * bases ran, so no base is asked about it.
   *
   * Empty over a green suite, and empty over a red suite whose every failing
   * file no span touched — the case that sends those files to the bases.
   */
  readonly ownFailingFiles: readonly string[];
  /**
   * Every failure the base runs over {@link failingFiles} reported, in the
   * order the bases were asked. Those runs happen exactly when the suite is
   * red, `failingFiles` is populated, and {@link ownFailingFiles} is empty, so
   * whether they happened is read off those rather than off a fourth field
   * restating them (`.claude/rules/engineering.md`, *Derived state is
   * computed, never restated beside its source*). Over a batch every distinct
   * base is asked, and a failure at any one of them is enough: a file red
   * before one of these spans existed is not a red the merge can be held to.
   *
   * Non-empty is the `base-red` outcome: the suite was failing before the
   * spans this merge carried existed.
   */
  readonly baseFailures: readonly TestFailure[];
}

/**
 * One span of the merge the judge is ruling over: an entry's named lines, and
 * the facts that tell what that span did from what it inherited.
 *
 * A span the merge carried with no entry — or one whose commit put its work
 * down — states empty line lists and keeps its {@link footprint}: its edits
 * are in the tree the suite ran over, so a failure in one of its files is the
 * merge's own however the bases run.
 */
export interface JudgeSpan {
  /** The entry's `tests[]`: green on the merged tree, red at this span's base. */
  readonly tests: readonly string[];
  /** The entry's `pins[]`: green on the merged tree, never run at the base. */
  readonly pins: readonly string[];
  /**
   * The entry's `laneTests[]`: a case only another host runs, each naming the
   * CI lane that runs it. Required rather than optional, as the two lists
   * above are — an entry naming none passes the empty list, and a reader
   * telling `undefined` from `[]` would decide the same thing twice.
   */
  readonly laneTests: readonly LaneTest[];
  /**
   * The commit this span's `tests[]` lines are judged against. Required rather
   * than optional: a judge handed no base cannot rule on a `tests[]` line, and
   * a caller that has no base sha resolves that before it gets here. Spans
   * sharing a value share one base tree, and each distinct value builds its
   * own — which is the whole of what a batch costs over a single span.
   */
  readonly baseSha: string;
  /**
   * This span's changed paths, in git's own alphabet — a gate hands over
   * `GateContext.touchedPaths`, or one `GateBatchSpan`'s, which the dispatcher
   * already computed. It is the only value that tells a failure the merge
   * caused from one it merely inherited, so it is required for the same reason
   * {@link baseSha} is: a caller with no footprint has no span, and a judge
   * handed none would read every red suite as the merge's.
   */
  readonly footprint: readonly string[];
}

/** What the judge is asked to rule on. */
export interface JudgeRequest {
  /**
   * The spans one merge carried, in the order they landed — never empty,
   * since a merge that carried no span runs no gate. A serial merge passes
   * one, which is the shape every arm below is written over.
   */
  readonly spans: readonly JudgeSpan[];
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
 * The clause the owed lines contribute to a message: how many, and to which
 * lanes. Empty when the entry named no `laneTests[]` line, so an ordinary
 * entry's message reads as it did.
 */
function owedClause(lines: readonly LineVerdict[]): string {
  const owed = lines.filter((l) => l.state === "owed");
  if (owed.length === 0) return "";
  const lanes = [...new Set(owed.map((l) => l.owedTo))].join(", ");
  return (
    `; ${owed.length} laneTests[] line(s) owed to ${lanes} — skipped here, ` +
    `proven by that lane`
  );
}

/** The clause a failure list contributes to a message: its first, or nothing. */
const firstOf = (failures: readonly TestFailure[]): string => {
  const first = failures[0];
  return first ? `, first ${first.file}${first.name ? ` × ${first.name}` : ""}` : "";
};

/**
 * The short shas a message names a set of base trees by, in first-seen order.
 * One for a serial merge, so a batch's message reads as the single-span one
 * did with one base in it.
 */
const shortBases = (shas: readonly string[]): string =>
  [...new Set(shas)].map((sha) => sha.slice(0, 7)).join(", ");

/**
 * Judge the named lines of every span one merge carried, through a declared
 * runner.
 *
 * The merged-tree run happens **once** over all of them and carries every
 * lane, because it is the consumer's whole suite either way — one span's or
 * five. The base runs happen only when a `tests[]` line survived to need one,
 * and then **one tree per distinct base**, over the union of the files the
 * lines of the spans sharing that base named and asked about exactly those
 * lines: a span is proved against the tree its own entry branched from, never
 * a sibling's. Only `tests[]` lines reach a base — a `pins[]` line names a
 * property that was already true, so asking whether it holds at the base is
 * asking a question whose answer changes nothing.
 *
 * A base run that fails is not a problem: red is the expectation there, and a
 * file that cannot even load at the base (it imports a symbol the entry
 * introduced) carries no passing test and so reads red — conservative in the
 * direction that matters.
 *
 * A `laneTests[]` line reaches no base run. Its case is one this host cannot
 * run, so the merged run is asked whether the case exists at all — skipped
 * counts — and the ruling stops there: the lane is the proof, and a base run
 * over a case that never ran here would compare two silences.
 *
 * A **red merged suite** reaches the bases too, and for the opposite question:
 * whether it was red before these spans existed. That question is asked only
 * when *no* failing file is in any span's footprint, and then over all of them
 * at every distinct base, through the same `runAtBase` — the overlay it lays
 * down is the working tree's copy of a file no span changed, so each base's
 * own verdict is what runs, and a failure at any one of them is a red the
 * merge did not make. One failing file a span *did* touch settles the blame
 * here and spends no base run: that overlay would carry the merge's own
 * breakage to a base and report it back as the base's.
 */
export async function judgeNamedLines(
  runner: Runner,
  request: JudgeRequest,
): Promise<JudgeVerdict> {
  const { spans, cwd } = request;
  if (spans.length === 0) {
    throw new Error(
      `the judge was handed no span to rule on: a merge that carried none ` +
        `runs no gate, so reaching here with none is the caller's bug and ` +
        `not a verdict to report (spec/harness.md, The judges).`,
    );
  }
  /** Every span's footprint: any one span's edit is in the tree the suite ran. */
  const spanFiles = new Set(spans.flatMap((s) => s.footprint));
  const bases = [...new Set(spans.map((s) => s.baseSha))];
  const tests = spans.flatMap((s) => s.tests);
  const pins = spans.flatMap((s) => s.pins);
  /** What the one merged-tree run is asked about: every span's lines, once. */
  const named = [
    ...new Set(
      spans.flatMap((s) => [
        ...s.tests,
        ...s.pins,
        ...s.laneTests.map((l) => l.title),
      ]),
    ),
  ];

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
  /**
   * One host-gated line. A case the run skipped is exactly as good as a case
   * it passed — neither proves the behavior here — so both read `owed`, and
   * only a title no test carries at all is refused. A case that *failed* here
   * never reaches this: the suite is red and the whole merge is unjudgeable
   * (`spec/harness.md`, *The judges*).
   */
  const draftLane = ({ lane, title }: LaneTest): LineVerdict => {
    const answer = answerFor(run, title, `the run in ${cwd}`);
    return {
      line: title,
      lane: "laneTests",
      state: answer.carried || answer.skipped ? "owed" : "unnamed",
      files: answer.files,
      owedTo: lane,
    };
  };
  /**
   * Each span's line verdicts, kept beside the span they came from: the base
   * half has to know whose base a `tests[]` line is proved at, and the flat
   * list the verdict reports is these in landing order.
   */
  const drafted: { readonly span: JudgeSpan; lines: readonly LineVerdict[] }[] =
    spans.map((span) => ({
      span,
      lines: [
        ...span.tests.map((line) => draft(line, "tests")),
        ...span.pins.map((line) => draft(line, "pins")),
        ...span.laneTests.map(draftLane),
      ],
    }));
  const lines = drafted.flatMap((d) => d.lines);

  if (!run.ok) {
    const at = shortBases(bases);
    // Every failing file is one no span touched, so the bases can be asked
    // whether they were failing already. One file a span *did* touch settles
    // the blame here, and no base run is spent.
    const askBase = failingFiles.length > 0 && observed.ownFailingFiles.length === 0;
    const baseFailures: TestFailure[] = [];
    if (askBase) {
      // Sequentially, one base tree at a time: each is a checkout the runner
      // plants and the gate boundary reclaims.
      for (const baseSha of bases) {
        const atBase = await runner.runAtBase([], failingFiles, baseSha, cwd);
        baseFailures.push(...atBase.failures);
      }
    }

    if (baseFailures.length > 0) {
      return {
        outcome: "base-red",
        message:
          `the suite was already red at ${at}: ${baseFailures.length} failure(s) there ` +
          `across ${failingFiles.length} file(s) no span of this merge touched` +
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
        // What the base runs found, and nothing concluded from them. A green
        // run over these files says the failure is not standing at that base;
        // it does not say this merge caused it — a load-sensitive case is red
        // on the merged tree and green at the base whichever span was
        // merging, and a drain reading a standing prior-attempt record acts
        // on the verdict either way.
        (askBase ? `; the same ${failingFiles.length} file(s) ran green at ${at}` : ""),
      lines,
      ...observed,
    };
  }

  if (lines.length === 0) {
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
        `${unnamed.length} of ${lines.length} named line(s) have no test: ${quote(unnamed)} ` +
        `— title a passing test with each line verbatim; a laneTests[] line's ` +
        `case is skipped on this host, never absent from the suite`,
      lines,
      ...observed,
    };
  }

  if (tests.length === 0) {
    return {
      outcome: "proven",
      message:
        `${pins.length} pins[] line(s) green (${run.passed} passed)` +
        owedClause(lines) +
        `; no tests[] line to run at the base`,
      lines,
      ...observed,
    };
  }

  // One base tree per distinct base among the spans that named a `tests[]`
  // line, each over the union of the files those spans' lines were carried in
  // and asked about exactly those lines. The answer is written back onto the
  // span it belongs to, so no line is ruled from a sibling's base.
  for (const baseSha of bases) {
    const own = drafted.filter(
      (d) => d.span.baseSha === baseSha && d.span.tests.length > 0,
    );
    if (own.length === 0) continue;
    const names = [...new Set(own.flatMap((d) => d.span.tests))];
    const files = [
      ...new Set(
        own.flatMap((d) =>
          d.lines.filter((l) => l.lane === "tests").flatMap((l) => l.files),
        ),
      ),
    ];
    if (files.length === 0) {
      throw new Error(
        `the runner reported ${names.length} carried tests[] line(s) and no file holding them, ` +
          `so there is nothing to lay over the base (spec/harness.md, The runner interface).`,
      );
    }
    const atBase = await runner.runAtBase(names, files, baseSha, cwd);
    for (const d of own) {
      d.lines = d.lines.map((l): LineVerdict =>
        l.lane === "tests"
          ? {
              ...l,
              state: answerFor(atBase, l.line, `the base run at ${baseSha}`).carried
                ? "green-on-base"
                : "proven",
            }
          : l,
      );
    }
  }
  const ruled = drafted.flatMap((d) => d.lines);
  const provedAt = shortBases(
    spans.filter((s) => s.tests.length > 0).map((s) => s.baseSha),
  );

  const greenOnBase = ruled.filter((l) => l.state === "green-on-base");
  if (greenOnBase.length > 0) {
    return {
      outcome: "green-on-base",
      message:
        `${greenOnBase.length} of ${tests.length} tests[] line(s) already pass at ` +
        `${provedAt}: ${quote(greenOnBase)} — each names a behavior the entry did not introduce`,
      lines: ruled,
      ...observed,
    };
  }

  return {
    outcome: "proven",
    message:
      `${tests.length} tests[] line(s) green (${run.passed} passed) and red at ${provedAt}` +
      (pins.length > 0 ? `; ${pins.length} pins[] line(s) green` : "") +
      owedClause(ruled),
    lines: ruled,
    ...observed,
  };
}
