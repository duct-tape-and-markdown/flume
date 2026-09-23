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
 * What is this module's own is the **reading** half: pure over vitest's own
 * `--reporter=json` output, so a test drives the real reporter through the
 * real reader rather than through a hand-authored report
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * Nothing here interprets: a run whose report and process disagree about
 * whether anything failed throws at the point of detection, as a run that
 * produced no report does, and every other observation leaves as a fact on
 * `RunResult` for a judge to rule on.
 */

import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import { existsLoud } from "../src/fsProbe.js";
import { gitPath, namespacedJoin } from "../src/paths.js";

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

/**
 * One run of vitest in `cwd`, through the spawn every shipped runner makes
 * (`captureRun`, `harness/toolRun.ts`): a non-zero exit is vitest's ordinary
 * way of saying "tests failed" and its report is still on stdout, so both the
 * output and the status come back and {@link readRun} reads them together.
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
  /** Its arguments, before the reporter flag and any file selection. */
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
   * How to reach vitest from a given tree. Defaults to `resolveVitest` —
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
        `dependencies are not installed there. (${(err as Error).message})`,
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

/**
 * The JSON report embedded in a captured run, or undefined when none parses.
 * vitest writes the report to stdout amid whatever else its plugins printed,
 * so the object is found by its first key rather than by assuming it stands
 * alone.
 */
function parseReport(output: string): Report | undefined {
  const start = output.indexOf('{"numTotalTestSuites"');
  if (start === -1) return undefined;
  try {
    return JSON.parse(output.slice(start, output.lastIndexOf("}") + 1)) as Report;
  } catch {
    return undefined;
  }
}

const firstLine = (s: string | undefined): string | undefined =>
  s === undefined ? undefined : (s.split("\n")[0] ?? undefined);

/**
 * Turn one run into facts. `root` is the tree the run happened in, so every
 * path reported is relative to it — identical strings whether the run was on
 * the merged tree or at the base.
 */
function readRun(run: CapturedRun, names: readonly string[], root: string): RunResult {
  const { stdout, status } = run;
  const report = parseReport(stdout);
  if (!report) {
    throw new Error(
      `vitest wrote no JSON report in ${root} — nothing to report on. ` +
        `Last output:\n${stdout.slice(-2000)}`,
    );
  }

  const rel = (p: string): string => gitPath(relative(root, p));

  const passing = report.testResults.flatMap((f) =>
    f.assertionResults
      .filter((a) => a.status === "passed")
      .map((a) => ({ file: rel(f.name), fullName: a.fullName })),
  );
  const named: NamedResult[] = names.map((name) => {
    const files = [
      ...new Set(passing.filter((p) => p.fullName.includes(name)).map((p) => p.file)),
    ];
    return { name, carried: files.length > 0, files };
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
        `report and there is nothing to rule on. Last output:\n` +
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
 * defaults describe the unsplit single-lane project — a consumer whose suite
 * splits states its own lanes rather than inheriting one implementation's.
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

  return ({ api, provision }: RunnerContext): Runner => {
    return {
      lanes,

      async run(names, cwd) {
        return readRun(await capture(invoke(cwd), ["--reporter=json"], cwd), names, cwd);
      },

      async runAtBase(names, files, baseSha, cwd) {
        const worktree = await baseTree(
          { api, provision },
          { label: "vitestRunner.runAtBase", files, baseSha, cwd },
        );
        const run = await capture(invoke(worktree), ["--reporter=json", ...files], worktree);
        return readRun(run, names, worktree);
      },
    };
  };
}
