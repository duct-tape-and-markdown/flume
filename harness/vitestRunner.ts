/**
 * The vitest runner the package ships (`spec/harness.md`, *The runner
 * interface*).
 *
 * Declared as a factory (`runner.ts`, {@link RunnerFactory}): the two things
 * its base checkout needs — the tree at a sha, and a way to provision that
 * tree's dependencies — are the chain load's to hand out, and both are read
 * off the context this factory is called with rather than re-derived beside
 * a consumer's declaration. The checkout itself is the engine's, planted by
 * the sequence every shipped runner shares (`baseTree`, `harness/toolRun.ts`),
 * so nothing here adds or removes a worktree.
 *
 * What is this module's own is the **reading** half: over the JSON report
 * vitest is told to write, at a file this module names and owns, so a test
 * drives the real reporter through the real reader rather than through a
 * hand-authored report (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*).
 *
 * Nothing here interprets: a run whose report and process disagree about
 * whether anything failed throws at the point of detection, as a run that
 * produced no report does and as a base run covering a file none of its
 * lines asked for does, and every other observation leaves as a fact on
 * `RunResult` for a judge to rule on.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { existsLoud, readFileLoudUnder } from "../src/fsProbe.js";
import { gitPath, namespacedJoin, plainPath } from "../src/paths.js";

import { resolveLanes } from "./runner.js";
import type {
  Lane,
  NamedResult,
  RunResult,
  Runner,
  RunnerContext,
  RunnerFactory,
  TestFailure,
} from "./runner.js";
import { baseTree, captureRun, type CapturedRun } from "./toolRun.js";
import { thrownMessage } from "../src/thrown.js";

/**
 * One run of vitest in `cwd`, through the spawn every shipped runner makes
 * (`captureRun`, `harness/toolRun.ts`): a non-zero exit is vitest's ordinary
 * way of saying "tests failed" and the report it was told to write is there
 * either way, so the status comes back beside whatever the run printed and
 * {@link readRun} reads them together with the file.
 */
const capture = (
  invocation: VitestInvocation,
  extra: readonly string[],
  cwd: string,
): Promise<CapturedRun> =>
  captureRun(invocation.command, [...invocation.args, ...extra], cwd);

/** How the runner reaches vitest from one tree. */
export interface VitestInvocation {
  /** The binary to spawn. */
  readonly command: string;
  /**
   * The arguments reaching vitest takes — the entry point and the
   * subcommand — before everything an operation appends. What the suite *is*
   * is not one of them: a filter spelled here would be read as part of how
   * the binary is reached and so could not be stated without restating the
   * binary, which is what {@link VitestRunnerOptions.scope} is for.
   */
  readonly args: readonly string[];
}

export interface VitestRunnerOptions {
  /**
   * The consumer's lanes. Defaults to the single unsplit lane; a project
   * whose vitest config excludes a slice of its suite from the default run
   * declares both lanes here, and the running lane's exclusions are rendered
   * into plan's `tests[]` and `pins[]` hints (`spec/harness.md`, *The runner
   * interface*) — plan is told which globs no judge will reach, never
   * refused for having predicted `files` that name one.
   */
  lanes?: readonly Lane[];
  /**
   * What the consumer's suite is, in vitest's own argument vocabulary — the
   * flags a run of it is scoped by (`--dir`, `--exclude`, `--project`, a
   * `--config` that is not the root one). Stated once here and passed to
   * every spawn both operations make, so a consumer narrowing its suite
   * states the narrowing where it declares the runner rather than inside
   * {@link invoke}, whose job is reaching the binary.
   *
   * Defaults to nothing stated, which is the suite the consumer's vitest
   * config already describes. The runner adds no argument of its own beyond
   * what reading a run needs — the reporter flag, and at the base the files
   * the judge's lines name, which narrow within this scope and never past it
   * (`spec/harness.md`, *The runner interface*).
   *
   * Scoping flags, not a bare path: a positional filter stated here reaches
   * vitest beside the base run's own file filters, where vitest reads the
   * set as a union — a scope that widens the base run rather than bounding
   * it. Which tokens are positional is not decidable from the argument list
   * (a flag's value is a bare token too), so the refusal is read off the run
   * that happened instead: a base run whose report names a test file none of
   * the judge's filters asked for throws, naming that file and this value. A
   * scope that bounds what the suite collects reaches the base run
   * unrefused.
   */
  scope?: readonly string[];
  /**
   * How to reach vitest from a given tree: the binary and the arguments that
   * reaching it takes, never what to run. Defaults to `resolveVitest` —
   * vitest's own entry point under this process's node. Takes the tree
   * because `runAtBase` runs in a checkout that is not the caller's cwd.
   */
  invoke?: (cwd: string) => VitestInvocation;
}

/**
 * Spawn vitest's own entry point under this process's node, resolved from
 * `cwd`'s dependency graph rather than from an assumed `node_modules`
 * layout.
 *
 * The tool, not a package-manager shim: `pnpm exec` and `npx` run under
 * their manager's configuration, which is not the suite's subject and
 * differs between a fresh checkout and the primary one
 * (`.claude/rules/platform-facts.md`, *A package-manager shim carries the
 * manager's state into a gate*).
 */
export function resolveVitest(cwd: string): VitestInvocation {
  let pkg: string;
  try {
    pkg = createRequire(join(cwd, "package.json")).resolve("vitest/package.json");
  } catch (err) {
    throw new Error(
      `vitestRunner: vitest does not resolve from ${cwd} — the tree's ` +
        `dependencies are not installed there. (${thrownMessage(err)})`,
    );
  }
  const entry = join(dirname(pkg), "vitest.mjs");
  if (!existsLoud(namespacedJoin(entry))) {
    throw new Error(
      `vitestRunner: vitest resolves from ${cwd} but its entry point is missing: ${entry}`,
    );
  }
  return { command: process.execPath, args: [entry, "run"] };
}

/** The slice of vitest's JSON report this reader consumes. */
interface Assertion {
  fullName: string;
  status: string;
  failureMessages?: string[];
}
interface FileResult {
  name: string;
  status: string;
  message?: string;
  assertionResults: Assertion[];
}
interface Report {
  success: boolean;
  numPassedTests: number;
  numFailedTests: number;
  testResults: FileResult[];
}

/** What a refusal calls the file below, as a bare noun phrase. */
const REPORT_SUBJECT = "the JSON report vitest was told to write";

/**
 * Run `body` against a report file this module owns, and take the file away
 * again however the run ended.
 *
 * Told, never found: both operations name where vitest writes its report and
 * read it back from exactly there, so what the tool printed around it — a
 * plugin's banner, a progress line, a release that stops printing the report
 * at all — cannot decide whether the run is readable
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * A fresh directory per run, outside every tree a run happens in: the
 * merged-tree run's `cwd` is the consumer's own checkout, where a report
 * written beside the suite is a file the consumer never asked for. And fresh
 * per run because the one way a told location reads worse than a scanned one
 * is a leftover: a report from the previous run answering this run's
 * question, which {@link readRun} cannot tell from the real thing.
 *
 * The directory is made in win32's namespaced alphabet and the file told in
 * its plain one: the told path is an argument another process resolves, not
 * an fs call of this package's, and the `\\?\` prefix is this package's
 * fix for its own `fs` calls rather than a spelling a tool has to accept
 * (`plainPath`, `src/paths.ts`). Every read of the file back is composed
 * again — here for the directory, and inside the reader for the file
 * ({@link loadReport}).
 */
async function withReportFile<T>(body: (file: string) => Promise<T>): Promise<T> {
  const dir = plainPath(await mkdtemp(namespacedJoin(tmpdir(), "flume-vitest-report-")));
  try {
    return await body(join(dir, "report.json"));
  } finally {
    await rm(namespacedJoin(dir), { recursive: true, force: true });
  }
}

/**
 * The report at the file vitest was told to write, or a refusal naming that
 * file. Nothing written there and bytes that are not a report are two
 * different things and say so, since the operator's next move differs: a tool
 * that ran and reported elsewhere against one whose output is not JSON at all.
 */
function loadReport(file: string, run: CapturedRun, root: string): Report {
  const raw = readFileLoudUnder(REPORT_SUBJECT, dirname(file), file);
  if (raw === null) {
    throw new Error(
      `vitest wrote no JSON report in ${root} — it was told to write one at ` +
        `${file} and wrote nothing there, so there is nothing to report on. ` +
        `Last output:\n${run.stdout.slice(-2000)}`,
    );
  }
  try {
    return JSON.parse(raw) as Report;
  } catch (err) {
    throw new Error(
      `vitest's JSON report in ${root} does not parse: the file it was told ` +
        `to write, ${file}, held ${raw.length} bytes that are not JSON ` +
        `(${thrownMessage(err)}). ` +
        `Its first bytes:\n${raw.slice(0, 2000)}`,
    );
  }
}

const firstLine = (s: string | undefined): string | undefined =>
  s === undefined ? undefined : (s.split("\n")[0] ?? undefined);

/** What a base run was narrowed by, which its own report is read against. */
interface BaseNarrowing {
  /** The files the judge's lines named, run-relative, as handed to the run. */
  readonly files: readonly string[];
  /** The consumer's declared scope, as it reached that run. */
  readonly scope: readonly string[];
}

/**
 * Refuse a base run whose report names a test file none of the filters it was
 * given asked for.
 *
 * The judge's one narrowing is the files its lines name, within whatever
 * scope the consumer declared (`spec/harness.md`, *The runner interface*),
 * and vitest collects a test file through a positional filter only when that
 * file's path contains the filter — so a reported file no filter is a
 * substring of is a file no line asked for, whatever else reached the
 * argument list.
 *
 * Read off the run rather than off the arguments: deciding argv-side which
 * tokens of a declared scope are positional needs vitest's own flag and arity
 * table, which is the tool's to change and wrong here for every two-token
 * flag (`.claude/rules/engine-boundary.md`, *Told, not inferred*). The report
 * states which files ran, `files` states which were asked for, and the
 * comparison needs nothing else. Loud at the point of detection, because the
 * alternative is handing the judge a verdict — a base failure, a carried
 * line — read over files its lines never named
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function refuseUnaskedFiles(
  reported: readonly string[],
  narrowing: BaseNarrowing,
  root: string,
): void {
  const unasked = [
    ...new Set(reported.filter((f) => !narrowing.files.some((asked) => f.includes(asked)))),
  ];
  if (unasked.length === 0) return;
  throw new Error(
    `vitest's base run in ${root} reported on ${unasked.length} test ` +
      `file(s) no judged line asked for: ${unasked.join(", ")}. The run was ` +
      `narrowed to ${narrowing.files.join(", ")}, so a verdict read off it ` +
      `would cover files the judge's lines never named. The declared scope ` +
      `reached that run as [${narrowing.scope.join(" ")}]: a positional ` +
      `filter there widens a base run instead of bounding it, since vitest ` +
      `reads it beside the files above as a union — and with no positional ` +
      `there, what collected them is the consumer's own vitest config.`,
  );
}

/**
 * Turn one run into facts, reading the report out of `file` — where this
 * runner told vitest to write it. `root` is the tree the run happened in, so
 * every path reported is relative to it — identical strings whether the run
 * was on the merged tree or at the base.
 *
 * `narrowing` is present for a base run and absent for a merged-tree one:
 * the base run is the only operation that filters by file, so it is the only
 * one whose report can name a file nothing asked for
 * ({@link refuseUnaskedFiles}).
 */
function readRun(
  run: CapturedRun,
  file: string,
  names: readonly string[],
  root: string,
  narrowing?: BaseNarrowing,
): RunResult {
  const { stdout, status } = run;
  const report = loadReport(file, run, root);

  const rel = (p: string): string => gitPath(relative(root, p));

  if (narrowing !== undefined) {
    refuseUnaskedFiles(
      report.testResults.map((f) => rel(f.name)),
      narrowing,
      root,
    );
  }

  const passing = report.testResults.flatMap((f) =>
    f.assertionResults
      .filter((a) => a.status === "passed")
      .map((a) => ({ file: rel(f.name), fullName: a.fullName })),
  );
  // The cases the run collected and declined to execute — the skip marker,
  // and the host-conditional form a host-gated case is written as. vitest's
  // own word for both is the status read here, and it is read as itself: a
  // todo case is a title with no body, which is a case nobody wrote rather
  // than one this host will not run, and reading the two as one would report
  // an unwritten `laneTests[]` case as owed to a lane (`spec/harness.md`,
  // *The judges*).
  const skipped = report.testResults.flatMap((f) =>
    f.assertionResults.filter((a) => a.status === "skipped").map((a) => a.fullName),
  );
  const named: NamedResult[] = names.map((name) => {
    const files = [
      ...new Set(passing.filter((p) => p.fullName.includes(name)).map((p) => p.file)),
    ];
    return {
      name,
      carried: files.length > 0,
      skipped: skipped.some((fullName) => fullName.includes(name)),
      files,
    };
  });

  const failures: TestFailure[] = [];
  for (const f of report.testResults) {
    if (f.status === "passed") continue;
    const failed = f.assertionResults.filter((a) => a.status === "failed");
    if (failed.length === 0) {
      // The file never reached a test — a collection error, an import that
      // does not resolve. There is no assertion to hang the message on, so
      // the file's own message is the failure and `name` stays absent.
      failures.push({
        file: rel(f.name),
        message: firstLine(f.message) ?? `the file did not run (status: ${f.status})`,
      });
      continue;
    }
    for (const a of failed) {
      failures.push({
        file: rel(f.name),
        name: a.fullName,
        message: firstLine(a.failureMessages?.[0]) ?? "failed with no message",
      });
    }
  }

  const ok = report.success && failures.length === 0;
  // The report is computed from the files that reported, and the status is
  // the whole process's. A run whose failure never reached a file — an
  // unhandled rejection, a worker that dropped — leaves the two disagreeing,
  // and reading the report alone there reports a green suite over a run that
  // failed (`.claude/rules/engineering.md`, *Loud or nothing*). A report
  // that already states failures is the ordinary non-zero exit and is read
  // as those failures.
  if (ok && status !== 0) {
    throw new Error(
      `vitest reported a green suite in ${root} but exited ${status} — the ` +
        `report and the process disagree, so what failed is outside the ` +
        `report and there is nothing to rule on. The report it was told to ` +
        `write claims success: ${report.numPassedTests} passed, ` +
        `${report.numFailedTests} failed. Last output:\n` +
        stdout.slice(-2000),
    );
  }

  return {
    ok,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    names: named,
    failures,
  };
}

/**
 * Declare the vitest runner. Every field of `options` is optional, and the
 * defaults describe the unsplit single-lane project whose suite is whatever
 * its vitest config already describes — a consumer whose suite splits states
 * its own lanes, and one whose suite is a slice of what that config collects
 * states its own `scope`, rather than either inheriting one
 * implementation's.
 *
 * Returns the factory, not the runner: what the returned function does with
 * the context it is called with is the whole reason `runner` is declared as one
 * (`runner.ts`, {@link RunnerFactory}). The lane refusal is raised here,
 * where a consumer's declaration module can red before a chain ever loads,
 * rather than deferred into the factory call.
 */
export function vitestRunner(options: VitestRunnerOptions = {}): RunnerFactory {
  const lanes = resolveLanes("vitestRunner", options.lanes);
  const invoke = options.invoke ?? resolveVitest;
  const scope = options.scope ?? [];
  // What every spawn here appends to the declared invocation, in one place
  // because it is one decision: what reading the run needs — the reporter,
  // and the file it is told to write — and then the consumer's declared
  // scope. A base run appends the judge's files after it, so the narrowing
  // lands inside the scope rather than beside it.
  const readingAndScope = (reportFile: string): string[] => [
    "--reporter=json",
    `--outputFile=${reportFile}`,
    ...scope,
  ];

  return ({ api, provision }: RunnerContext): Runner => {
    return {
      lanes,

      async run(names, cwd) {
        return withReportFile(async (reportFile) => {
          const run = await capture(invoke(cwd), readingAndScope(reportFile), cwd);
          return readRun(run, reportFile, names, cwd);
        });
      },

      async runAtBase(names, files, baseSha, cwd) {
        const worktree = await baseTree(
          { api, provision },
          { label: "vitestRunner.runAtBase", files, baseSha, cwd },
        );
        return withReportFile(async (reportFile) => {
          const run = await capture(
            invoke(worktree),
            [...readingAndScope(reportFile), ...files],
            worktree,
          );
          return readRun(run, reportFile, names, worktree, { files, scope });
        });
      },
    };
  };
}
