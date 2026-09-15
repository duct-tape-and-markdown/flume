/**
 * The vitest runner the package ships (`spec/harness.md`, *The runner
 * interface*).
 *
 * Declared as a factory (`runner.ts`, {@link RunnerFactory}): the two things
 * its base checkout needs — an installer for the checkout's dependencies and
 * a place to plant it — are the engine's to hand out, and both are read off
 * the API this factory is called with rather than re-derived beside a
 * consumer's declaration.
 *
 * Its reading half is pure over vitest's own `--reporter=json` output, so a
 * test drives the real reporter through the real reader rather than through
 * a hand-authored report (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*). Its spawning half reuses the engine's git,
 * probe and spawn mechanism rather than re-deriving it beside `src/`.
 *
 * Nothing here interprets: a run that produced no report throws at the point
 * of detection, and every other observation leaves as a fact on `RunResult`
 * for a judge to rule on.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

import type { FlumeApi } from "../src/flumeApi.js";
import { existsLoud } from "../src/fsProbe.js";
import { addWorktree, removeWorktree } from "../src/git.js";
import { gitPath, worktreesBase } from "../src/paths.js";
import { execFileWithShimRetry } from "../src/spawnShim.js";

import type {
  Lane,
  NamedResult,
  RunResult,
  Runner,
  RunnerFactory,
  TestFailure,
} from "./runner.js";

/** The lane a plain, unsplit vitest project has: everything, nothing excluded. */
const DEFAULT_LANE: Lane = { name: "default", excludes: [], runs: true };

/** A report past this is a runaway, not a suite. */
const MAX_OUTPUT_BYTES = 64 << 20;

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
   * declares both lanes here, so a judge can refuse a line homed in the lane
   * this runner will not reach.
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
  if (!existsLoud(entry)) {
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
 * Turn one run's output into facts. `root` is the tree the run happened in,
 * so every path reported is relative to it — identical strings whether the
 * run was on the merged tree or at the base.
 */
function readRun(output: string, names: readonly string[], root: string): RunResult {
  const report = parseReport(output);
  if (!report) {
    throw new Error(
      `vitest wrote no JSON report in ${root} — nothing to report on. ` +
        `Last output:\n${output.slice(-2000)}`,
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

  return {
    ok: report.success && failures.length === 0,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    names: named,
    failures,
    failingFiles: [...new Set(failures.map((f) => f.file))],
  };
}

/**
 * Spawn and capture. A non-zero exit is vitest's ordinary way of saying
 * "tests failed" and its report is still on stdout, so the exit status is
 * read only to tell that case from a spawn that never started — where
 * `code` is an errno string and there is no report to hand back.
 */
async function capture(
  invocation: VitestInvocation,
  extra: readonly string[],
  cwd: string,
): Promise<string> {
  try {
    const { stdout } = await execFileWithShimRetry(
      invocation.command,
      [...invocation.args, ...extra],
      { cwd, maxBuffer: MAX_OUTPUT_BYTES },
    );
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    if (typeof e.code === "number" && typeof e.stdout === "string") return e.stdout;
    throw err;
  }
}

/**
 * Declare the vitest runner. Every field of `options` is optional, and the
 * defaults describe the unsplit single-lane project — a consumer whose suite
 * splits states its own lanes rather than inheriting one implementation's.
 *
 * Returns the factory, not the runner: what the returned function does with
 * the API it is called with is the whole reason `runner` is declared as one
 * (`runner.ts`, {@link RunnerFactory}). The lane refusal is raised here,
 * where a consumer's declaration module can red before a chain ever loads,
 * rather than deferred into the factory call.
 */
export function vitestRunner(options: VitestRunnerOptions = {}): RunnerFactory {
  const lanes = options.lanes ?? [DEFAULT_LANE];
  const running = lanes.filter((l) => l.runs);
  if (running.length !== 1) {
    throw new Error(
      `vitestRunner: exactly one lane must carry \`runs\`, got ${running.length} of ` +
        `${lanes.length} (${lanes.map((l) => l.name).join(", ") || "no lanes"}). ` +
        `The judge runs one lane; which one cannot be guessed.`,
    );
  }
  const invoke = options.invoke ?? resolveVitest;

  return (api: FlumeApi): Runner => {
    /**
     * Where a base checkout is planted: the engine's own resolution of the
     * state root's worktree base, honoring the operator's relocation of it.
     * Not a temp directory — a run killed mid-flight leaves this checkout
     * registered under the base the engine's startup sweep reads, so it is
     * reclaimed rather than accumulating somewhere nothing looks.
     */
    const base = worktreesBase(api.paths.flumeDir);

    return {
      lanes,

      async run(names, cwd) {
        const output = await capture(invoke(cwd), ["--reporter=json"], cwd);
        return readRun(output, names, cwd);
      },

      async runAtBase(names, files, baseSha, cwd) {
        if (files.length === 0) {
          throw new Error(
            "vitestRunner.runAtBase: no files to lay over the base. A base run " +
              "with no selection runs the whole suite there, which judges the " +
              "wrong thing and costs a suite.",
          );
        }
        const worktree = join(base, `base-${baseSha.slice(0, 7)}`);
        try {
          await removeWorktree(cwd, worktree);
          await mkdir(base, { recursive: true });
          await addWorktree({ repoRoot: cwd, path: worktree, fromRef: baseSha });
          for (const f of files) {
            const from = resolve(cwd, f);
            if (!existsLoud(from)) {
              throw new Error(`vitestRunner.runAtBase: ${f} is not in the tree at ${cwd}`);
            }
            await mkdir(dirname(join(worktree, f)), { recursive: true });
            await copyFile(from, join(worktree, f));
          }
          // A checkout of a git ref has no installed dependencies. The
          // engine's own lockfile-aware installer provisions it, so the base
          // tree is provisioned exactly the way a build worktree is — one
          // implementation of that, on the API, rather than a second one
          // here.
          await api.setupWorktree(worktree);
          const output = await capture(invoke(worktree), ["--reporter=json", ...files], worktree);
          return readRun(output, names, worktree);
        } finally {
          await removeWorktree(cwd, worktree);
        }
      },
    };
  };
}
