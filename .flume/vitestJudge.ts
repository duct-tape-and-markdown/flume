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
import { relative } from "node:path";
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
