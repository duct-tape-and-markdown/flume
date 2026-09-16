/**
 * The package's judge as a gate (`spec/harness.md`, *The judges*) — the one
 * seam between the ruling `judge.ts` computes and the `Gate` a phase hangs:
 * which spans it declines to rule on, and how a refusal reads on the
 * dispatcher's verdict.
 *
 * The ruling itself lives in `judge.ts` and the runner that observes it in
 * `runner.ts`; nothing here re-decides either. What this module owns is the
 * gate's own vocabulary: the two skips, and the detail block.
 */

import type { Gate, GateContext, GateResult } from "../src/Gate.js";
import type { PendingEntry } from "../src/PendingSchema.js";

import { NamedLinesSchema } from "./entryExtension.js";
import { judgeNamedLines, type JudgeVerdict } from "./judge.js";
import type { Runner } from "./runner.js";

/**
 * Whether a build commit is a park — the chain factory's predicate, handed
 * in rather than rebuilt here. What a park *is* is the package's vocabulary
 * over paths the factory composed (`chain.ts`), and a second spelling of it
 * beside the gate would be the copy that goes stale
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
type ParkPredicate = (
  entry: PendingEntry,
  touched: readonly string[],
) => boolean;

/**
 * The judge as a gate on the merged tree (`spec/harness.md`, *The judges*):
 * the consumer's suite is green, every `tests[]` line has a passing test
 * that fails at the base, and every `pins[]` line has one here.
 *
 * `afterMerge`, not `afterCommit`: under fanout, N parallel suites contend
 * for the host and revert clean commits on timing alone, while an
 * `afterMerge` revert is per-entry. The base half needs a base sha, which
 * is a fact of the gated span either way.
 *
 * A park is not judged. Its named lines belong to work the park did not
 * attempt, and judging them would revert the note — throwing away the one
 * channel the tick had for saying why it could not ship. Spelled as a skip
 * rather than an unexplained green (`.claude/rules/engineering.md`, *A green
 * verdict is proven non-vacuous*).
 */
export function namedLinesGate(runner: Runner, isPark: ParkPredicate): Gate {
  return {
    name: "named lines",
    when: "afterMerge",
    async run(ctx: GateContext): Promise<GateResult> {
      const entry = ctx.entry;
      if (entry === undefined) {
        return {
          ok: true,
          message: "no entry on this span",
          skipped: "the judge rules on one entry's named lines",
        };
      }
      if (isPark(entry, ctx.touchedPaths)) {
        return {
          ok: true,
          message: `${entry.tag}: parked — a note under the parked directory`,
          skipped: "a park attempts none of the entry's named lines",
        };
      }
      const verdict = await judgeNamedLines(runner, {
        tests: NamedLinesSchema.parse(entry.tests),
        pins: NamedLinesSchema.parse(entry.pins),
        baseSha: ctx.baseSha,
        cwd: ctx.repoRoot,
      });
      if (verdict.outcome === "proven") {
        return { ok: true, message: verdict.message };
      }
      if (verdict.outcome === "empty") {
        // The entry named no behavior, and the suite is green over it. The
        // empty case is asserted rather than inherited: what it costs is
        // the chain's policy, and this package's is "nothing" — plan not
        // naming a line is plan's defect to fix, not this commit's.
        return {
          ok: true,
          message: verdict.message,
          skipped: "the entry named no line to judge",
        };
      }
      return {
        ok: false,
        message: verdict.message,
        details: details(verdict),
        ...(verdict.failingFiles.length > 0
          ? { failingFiles: [...verdict.failingFiles] }
          : {}),
      };
    },
  };
}

/**
 * Every fact the judge ruled from, one line each — the line verdicts the
 * agent has to act on, then the failures the suite reported.
 *
 * Composed from the verdict's own fields rather than parsed back out of its
 * message: the judge reports facts precisely so a caller does not have to
 * pattern-match its prose (`.claude/rules/engineering.md`, *A fact the
 * engine holds is reported, never rediscovered*).
 */
function details(verdict: JudgeVerdict): string {
  const lines = verdict.lines.map(
    (line) =>
      `${line.lane}[] ${line.state}: ${JSON.stringify(line.line)}` +
      (line.files.length > 0 ? ` (${line.files.join(", ")})` : ""),
  );
  const failures = verdict.failures.map(
    (failure) =>
      `FAIL ${failure.file}${failure.name ? ` × ${failure.name}` : ""}: ${failure.message}`,
  );
  return [...lines, ...failures].join("\n");
}
