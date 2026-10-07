/**
 * The package's judge as a gate (`spec/harness.md`, *The judges*) — the one
 * seam between the ruling `judge.ts` computes and the `Gate` a phase hangs:
 * which spans it declines to rule on, and how a refusal reads on the
 * dispatcher's verdict.
 *
 * The ruling itself lives in `judge.ts` and the runner that observes it in
 * `runner.ts`; nothing here re-decides either. What this module owns is the
 * gate's own vocabulary: the skips and how each reads, the `base-red`
 * discriminant a refusal carries, and the detail block.
 */

import type {
  BatchGateContext,
  BatchingGate,
  GateContext,
  GateResult,
} from "../src/Gate.js";
import type { PendingEntry } from "../src/PendingSchema.js";

import { LaneTestsSchema, NamedLinesSchema } from "./entryExtension.js";
import { judgeNamedLines, type JudgeSpan, type JudgeVerdict } from "./judge.js";
import type { PutDownKind, PutDownPredicate } from "./putDown.js";
import type { Runner, TestFailure } from "./runner.js";

/**
 * How each put-down reads on the verdict: what the commit said, and why the
 * named lines went unjudged. Keyed exhaustively by {@link PutDownKind}, so a
 * further note home whose location is a verdict is a typecheck failure here
 * rather than a skip that reads as a park.
 */
const PUT_DOWN: Record<PutDownKind, { said: string; skipped: string }> = {
  parked: {
    said: "parked — a note under the parked directory",
    skipped: "a park attempts none of the entry's named lines",
  },
  continuing: {
    said: "continuing — a note under the continuing directory",
    skipped:
      "the named lines belong to the completed entry, not to a segment of it",
  },
};

/**
 * The per-span facts the gate reads, whichever context shape it was handed: a
 * single span states them on the context itself, a batch once per span on
 * `BatchGateContext.batch`. Read through one shape so the entry lookup, the
 * put-down consult and the footprint are spelled once
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
interface SpanFacts {
  /** The entry this span was provisioned for — absent on one carrying none. */
  readonly entry?: PendingEntry | undefined;
  /** The sha this span started from: the base its `tests[]` lines are proved at. */
  readonly baseSha: string;
  /** This span's own changed paths, as the dispatcher computed them. */
  readonly touchedPaths: readonly string[];
}

/** Why one span of the merge has no named line to judge, and what it said. */
interface SpanSkip {
  /** What the span's commit said, for the gate's own message. */
  readonly message: string;
  /** Why its lines went unjudged — the `skipped` reason when no span judged. */
  readonly skipped: string;
}

/** The skip a span carrying no entry contributes: there is no entry to rule on. */
const NO_ENTRY: SpanSkip = {
  message: "no entry on this span",
  skipped: "the judge rules on one entry's named lines",
};

/** Each distinct value of one field of the skips, in first-seen order. */
const said = (skips: readonly SpanSkip[], field: keyof SpanSkip): string =>
  [...new Set(skips.map((s) => s[field]))].join("; ");

/**
 * The judge as a gate on the merged tree (`spec/harness.md`, *The judges*):
 * the consumer's suite is green, every `tests[]` line has a passing test
 * that fails at the base, every `pins[]` line has one here, and every
 * `laneTests[]` line has a case this host skipped rather than one nobody
 * wrote — owed to its lane, never counted green.
 *
 * `afterMerge`, not `afterCommit`: under fanout, N parallel suites contend
 * for the host and revert clean commits on timing alone, while an
 * `afterMerge` revert is per-entry. The base half needs a base sha, which
 * is a fact of the gated span either way.
 *
 * A commit that put its work down is not judged. A park attempted none of
 * the entry's named lines, and judging them would revert the note — throwing
 * away the one channel the tick had for saying why it could not ship. A
 * continuation landed a green segment, and the lines belong to the completed
 * entry rather than to a segment of it, so judging them would revert a span
 * the entry keeps (`spec/harness.md`, *A tick puts work down*). Each is
 * spelled as its own skip rather than an unexplained green
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 *
 * A suite that was already red at the span's base still refuses — an entry is
 * unjudgeable on a red tree either way — but the refusal carries
 * `verdict: "base-red"` and `blamesSpan: false`, which the dispatcher copies
 * verbatim onto the tick verdict's gate row and onto the `gate-revert`
 * prior-attempt record (`spec/chain.md`, *What a gate returns*). The retry
 * reads the fact beside the message, and the engine withholds the
 * entry-scoped blame: no quarantine key for a span whose failure predates
 * it. The two are declared separately because `blamesSpan` is the engine's
 * to act on and `verdict` is the chain's to read — a gate keying the
 * quarantine off its own prose would be the inference
 * `.claude/rules/engine-boundary.md`, *Told, not inferred* refuses.
 *
 * **It declares `batches`**, which is what lets a batched merge reach it at
 * all: a phase batches only where every one of its `afterMerge` gates says it
 * reads a batch (`mergeBatchWidth`, `src/gateBatch.ts`), so an undeclared
 * judge would hold every phase that hangs it to one span per merge. What the
 * declaration buys is paid for in `judge.ts`: one suite run over the merged
 * tree, and each entry's `tests[]` proved at that entry's own base. Each span
 * is consulted for its own put-down and its own entry, so a batch carrying a
 * park judges its siblings and leaves the parked span's lines unattempted —
 * and a batch whose every span put its work down or carried no entry skips as
 * a single such span does.
 */
export function namedLinesGate(
  runner: Runner,
  putDown: PutDownPredicate,
): BatchingGate {
  return {
    name: "named lines",
    when: "afterMerge",
    batches: true,
    async run(ctx: GateContext | BatchGateContext): Promise<GateResult> {
      const carried: readonly SpanFacts[] =
        ctx.batch === undefined
          ? [
              {
                entry: ctx.entry,
                baseSha: ctx.baseSha,
                touchedPaths: ctx.touchedPaths,
              },
            ]
          : ctx.batch;

      // Every span the merge carried reaches the judge: one with lines to
      // judge states them, and one without states its footprint alone, since
      // its edits are in the tree the suite runs over either way.
      const spans: JudgeSpan[] = [];
      const skips: SpanSkip[] = [];
      for (const span of carried) {
        const unjudged = {
          tests: [],
          pins: [],
          laneTests: [],
          baseSha: span.baseSha,
          footprint: span.touchedPaths,
        };
        const entry = span.entry;
        if (entry === undefined) {
          skips.push(NO_ENTRY);
          spans.push(unjudged);
          continue;
        }
        // `afterMerge`, so the tree that holds the span's commit is the trunk
        // it landed on — the same root the judge runs the suite in below.
        const kind = putDown(entry, {
          touched: span.touchedPaths,
          tree: ctx.repoRoot,
        });
        if (kind !== undefined) {
          skips.push({
            message: `${entry.tag}: ${PUT_DOWN[kind].said}`,
            skipped: PUT_DOWN[kind].skipped,
          });
          spans.push(unjudged);
          continue;
        }
        spans.push({
          tests: NamedLinesSchema.parse(entry.tests),
          pins: NamedLinesSchema.parse(entry.pins),
          // Narrowed here for the reason the two above are: the queue's own
          // schema is what the gate reads the field back through, never a
          // second spelling of it (`entryExtension.ts`).
          laneTests: LaneTestsSchema.parse(entry.laneTests),
          baseSha: span.baseSha,
          // The span's own footprint, as the dispatcher already computed it:
          // the judge tells a failing file this merge changed from one it
          // inherited, and nothing here re-derives the diff
          // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
          footprint: span.touchedPaths,
        });
      }
      if (skips.length === carried.length) {
        return {
          ok: true,
          message: said(skips, "message"),
          skipped: said(skips, "skipped"),
        };
      }

      const verdict = await judgeNamedLines(runner, {
        spans,
        cwd: ctx.repoRoot,
      });
      // What the spans the judge ruled nothing for said, beside the ruling: a
      // batch's verdict is over fewer entries than it carried, and the gate's
      // own message is the surface that says which
      // (`.claude/rules/engineering.md`, *A green verdict is proven
      // non-vacuous*). Empty for a merge whose every span was judged, so a
      // serial merge's message reads as it did.
      const message =
        skips.length === 0
          ? verdict.message
          : `${verdict.message} (${said(skips, "message")})`;
      if (verdict.outcome === "proven") {
        return { ok: true, message };
      }
      if (verdict.outcome === "empty") {
        // The entry named no behavior, and the suite is green over it. The
        // empty case is asserted rather than inherited: what it costs is
        // the chain's policy, and this package's is "nothing" — plan not
        // naming a line is plan's defect to fix, not this commit's.
        return {
          ok: true,
          message,
          skipped: "the entry named no line to judge",
        };
      }
      return {
        ok: false,
        message,
        details: details(verdict),
        // A discriminant the engine copies verbatim and reads no further, so
        // a chain keying its retry policy on the string is keying on this
        // literal — and beside it the one field the engine does act on: the
        // base was red before this span, so the failure is not the span's to
        // be quarantined for.
        ...(verdict.outcome === "base-red"
          ? { verdict: "base-red", blamesSpan: false as const }
          : {}),
        ...(verdict.failingFiles.length > 0
          ? { failingFiles: [...verdict.failingFiles] }
          : {}),
      };
    },
  };
}

/** One failure as a detail line: where it was attributed, and what it said. */
const rendered = (failure: TestFailure): string =>
  `${failure.file}${failure.name ? ` × ${failure.name}` : ""}: ${failure.message}`;

/**
 * Every fact the judge ruled from, one line each — the line verdicts the
 * agent has to act on, then the failures the suite reported, then whatever
 * the base run over them found, each prefixed so the two runs are not one
 * list a reader has to guess the halves of.
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
      // The lane a host-gated line is owed to, off the verdict's own field: a
      // reader acting on the line has to know which lane will prove the case,
      // and re-joining the entry to find out is the rediscovery the verdict
      // reports to prevent.
      (line.owedTo === undefined ? "" : ` (lane ${line.owedTo})`) +
      (line.files.length > 0 ? ` (${line.files.join(", ")})` : ""),
  );
  const failures = verdict.failures.map((failure) => `FAIL ${rendered(failure)}`);
  const atBase = verdict.baseFailures.map(
    (failure) => `FAIL AT BASE ${rendered(failure)}`,
  );
  return [...lines, ...failures, ...atBase].join("\n");
}
