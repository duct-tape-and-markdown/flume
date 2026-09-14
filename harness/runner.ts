/**
 * The runner interface (`spec/harness.md`, *The runner interface*) — the one
 * seam between the harness package's judges and whatever test tool a
 * consumer runs.
 *
 * Every operation returns a **structured result**, never an exit code: the
 * judge reads facts (which named line a passing test carried, which file the
 * failure was attributed to, which lane the runner will not reach) and
 * decides what they mean. A runner that handed back a status would be making
 * the judge reconstruct a statement it could have been told
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * A consumer with cargo, dotnet, or a shell script declares its own value
 * against these three operations; `vitestRunner.ts` is the one the package
 * ships.
 */

/**
 * One selection of the consumer's suite, run as a unit. Lanes exist because
 * a suite that splits — a fast lane and a slow one — can only judge a named
 * behavior whose test lands in the lane the judge actually runs, and the
 * judge would otherwise discover that after a wave rather than at plan time.
 */
export interface Lane {
  /** The lane's name, as the consumer's own tooling spells it. */
  readonly name: string;
  /**
   * Patterns for the test files this lane does not run, in the consumer's
   * own glob vocabulary — vitest's `exclude`, cargo's filters. Reported for
   * the judge to match a declared file against; never interpreted here.
   */
  readonly excludes: readonly string[];
  /**
   * True for the lane `run` and `runAtBase` execute. Exactly one lane
   * carries it — a runner constructed with none or several refuses.
   */
  readonly runs: boolean;
}

/** Whether one named line was carried by a passing test, and where. */
export interface NamedResult {
  /** The line, verbatim as it was asked about. */
  readonly name: string;
  /** True when at least one passing test's full name contains the line. */
  readonly carried: boolean;
  /**
   * The run-relative files holding those passing tests. Empty exactly when
   * `carried` is false — the judge reads this to decide which files to lay
   * over the base.
   */
  readonly files: readonly string[];
}

/** One failure the run reported, attributed to the file that produced it. */
export interface TestFailure {
  /** Run-relative path of the file the failure was attributed to. */
  readonly file: string;
  /**
   * The failing test's full name. Absent when the file itself never got as
   * far as a test — a collection error, an import that does not resolve.
   */
  readonly name?: string;
  /** The failure's first line; the rest is the consumer's to fetch. */
  readonly message: string;
}

/** What one invocation of the runner observed. */
export interface RunResult {
  /** True when the run reported no failure of any kind. */
  readonly ok: boolean;
  /** How many tests passed — the judge's vacuity check. */
  readonly passed: number;
  /** How many tests failed. */
  readonly failed: number;
  /** One entry per requested name, in the order they were requested. */
  readonly names: readonly NamedResult[];
  /** Every failure, in report order. */
  readonly failures: readonly TestFailure[];
  /** The run-relative files a failure was attributed to, deduplicated. */
  readonly failingFiles: readonly string[];
}

/** The three operations a consumer's `runner` declaration supplies. */
export interface Runner {
  /**
   * Run the suite in `cwd` and report, per line in `names`, whether one
   * passing test carried it.
   */
  run(names: readonly string[], cwd: string): Promise<RunResult>;
  /**
   * Lay the working-tree bytes of `files` over a detached checkout of
   * `baseSha` and run the same names there, so a judge can see whether a
   * named behavior already held before the change. `files` is required: a
   * base run over the whole suite judges the wrong thing and costs a suite.
   */
  runAtBase(
    names: readonly string[],
    files: readonly string[],
    baseSha: string,
    cwd: string,
  ): Promise<RunResult>;
  /** The runner's declared lanes, and which files each excludes. */
  readonly lanes: readonly Lane[];
}
