/**
 * The chain's reading of a vitest JSON report: the suite's verdict, the
 * files it attributes failures to, and whether every behavior an entry's
 * `tests[]` names has a passing test whose full name carries the line.
 *
 * Acceptance-driven backpressure: plan names the behavior, build titles a
 * passing test with it verbatim, and this judge — run by the `vitest` gate
 * at afterMerge — proves the name has a test rather than trusting the
 * commit body. Pure over the report text so the real reporter's output can
 * be driven through it in a test (`engineering.md`, *A seam gate reads what
 * the real writer wrote*). The engine never reads `tests[]`; this is the
 * chain's contract with itself.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { GateResult } from "../src/Gate.ts";

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

/** The JSON report embedded in a gate's captured output, or undefined when none parses. */
export function parseVitestReport(details: string | undefined): Report | undefined {
  if (!details) return undefined;
  const start = details.indexOf('{"numTotalTestSuites"');
  if (start === -1) return undefined;
  try {
    return JSON.parse(details.slice(start, details.lastIndexOf("}") + 1)) as Report;
  } catch {
    return undefined;
  }
}

/**
 * Judge a run. `suiteOk` is the runner's own exit verdict — a report can be
 * absent when the runner died before writing one, in which case the exit
 * verdict is all there is.
 */
export function judgeVitestReport(
  details: string | undefined,
  suiteOk: boolean,
  named: readonly string[],
  repoRoot: string,
): GateResult {
  const report = parseVitestReport(details);
  if (!report) {
    return suiteOk
      ? { ok: false, message: "vitest exited green but wrote no JSON report — nothing to judge", ...(details ? { details } : {}) }
      : { ok: false, message: "vitest failed before writing a report — wave reverted", ...(details ? { details } : {}) };
  }
  if (!suiteOk || !report.success || report.numFailedTests > 0) {
    const failed = report.testResults.filter((f) => f.status !== "passed");
    const summary = failed.flatMap((f) => [
      `${relative(repoRoot, f.name)}${f.message ? `: ${f.message.split("\n")[0]}` : ""}`,
      ...f.assertionResults
        .filter((a) => a.status === "failed")
        .map((a) => `  × ${a.fullName}${a.failureMessages?.[0] ? ` — ${a.failureMessages[0].split("\n")[0]}` : ""}`),
    ]);
    return {
      ok: false,
      message: `${report.numFailedTests} test(s) failed — wave reverted`,
      details: summary.join("\n"),
      failingFiles: failed.map((f) => relative(repoRoot, f.name).split("\\").join("/")),
    };
  }
  const passing = report.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === "passed");
  const missing = named.filter((line) => !passing.some((a) => a.fullName.includes(line)));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `${missing.length} of ${named.length} named behavior(s) have no passing test — wave reverted`,
      details: ["Title a passing test with each line verbatim (its full name must contain the line):", ...missing.map((m) => `- ${m}`)].join("\n"),
    };
  }
  return {
    ok: true,
    message: `vitest green (${report.numPassedTests} passed)${named.length > 0 ? `; ${named.length} named behavior(s) each have a passing test` : "; no behavior named by the entry"}`,
  };
}

// ---------- red on the base ----------

/** Repo-relative files holding a passing test titled with a named line — where the pins live. */
export function filesPinning(details: string | undefined, named: readonly string[], repoRoot: string): string[] {
  const report = parseVitestReport(details);
  if (!report) return [];
  const files = new Set<string>();
  for (const f of report.testResults) {
    if (f.assertionResults.some((a) => a.status === "passed" && named.some((line) => a.fullName.includes(line)))) {
      files.add(relative(repoRoot, f.name).split("\\").join("/"));
    }
  }
  return [...files];
}

/**
 * Check `baseSha` out detached at `worktreePath` and lay the merged commit's
 * bytes for `files` over it — the fix's tests on the pre-fix tree. `readAtRef`
 * is the engine's reader (`api.git.readFileAtRef`), so a bad ref fails loud
 * and a path absent from the commit is named, never skipped.
 */
export async function materializeBase(
  repoRoot: string,
  baseSha: string,
  mergedSha: string,
  files: readonly string[],
  worktreePath: string,
  readAtRef: (repoRoot: string, ref: string, path: string) => Promise<string | null>,
): Promise<void> {
  removeWorktree(repoRoot, worktreePath);
  execFileSync("git", ["worktree", "add", "--detach", worktreePath, baseSha], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const f of files) {
    const bytes = await readAtRef(repoRoot, mergedSha, f);
    if (bytes === null) throw new Error(`red-on-base: ${f} is not in ${mergedSha.slice(0, 7)}`);
    mkdirSync(dirname(join(worktreePath, f)), { recursive: true });
    writeFileSync(join(worktreePath, f), bytes);
  }
}

/** Remove a throwaway worktree; absent is fine. */
export function removeWorktree(repoRoot: string, worktreePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    // nothing at that path, or not a worktree — either way there is nothing to remove
  }
}

/**
 * At the base every named behavior must lack a passing test; the runner's
 * exit status is irrelevant, red is the expectation. A file that fails to
 * load there (a symbol the fix introduced) has no passing tests and reads
 * as red — conservative in the direction that matters.
 */
export function judgeRedOnBase(details: string | undefined, named: readonly string[]): GateResult {
  const report = parseVitestReport(details);
  if (!report) {
    return { ok: false, message: "red-on-base: vitest wrote no report at the base — nothing to judge", ...(details ? { details } : {}) };
  }
  const passing = report.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === "passed");
  const green = named.filter((line) => passing.some((a) => a.fullName.includes(line)));
  if (green.length > 0) {
    return {
      ok: false,
      message: `${green.length} of ${named.length} named behavior(s) already pass on the base — the test pins nothing this entry changed`,
      details: ["A tests[] line names a behavior the entry introduces; its test fails on the pre-fix tree:", ...green.map((g) => `- ${g}`)].join("\n"),
    };
  }
  return { ok: true, message: `${named.length} named behavior(s) red on the base` };
}
