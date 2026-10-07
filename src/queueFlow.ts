/**
 * The queue's flow figures — the line `flume status` ends its listing with
 * (spec/cli.md, "`flume status` owes exactly this"): how long an entry takes
 * to get from filing to shipping, how long the oldest ready entry has been
 * waiting right now, and how many merges failed per entry shipped.
 *
 * One job: fold the two histories the engine already keeps into three
 * numbers and spell them. Nothing here reads disk, and nothing here is
 * stored — the figures are a derivation over the filing times
 * (`readFilingTimes`, `src/filingOrder.ts`) and the verdict history
 * (`readTickVerdicts`, `src/tickVerdict.ts`), taken at the moment of asking.
 * A stored copy would be a second home for a fact those two artifacts
 * already own, going stale against the history it summarizes
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * Every figure states the population it could not reach rather than
 * answering zero over it: a median no ship could be timed for, a wait no
 * ready entry could be timed for, and a rate with no ship to divide by each
 * read as not yet measurable, and a filing read that failed outright says so
 * in place of the two figures it feeds
 * (`.claude/rules/engineering.md`, *Loud or nothing*). Zero is a figure, and
 * printing it over an input nothing resolved is the one reading this line may
 * never have.
 */

import type { PendingEntry } from "./PendingSchema.js";
import type { FilingTimes } from "./filingOrder.js";
import type { TickVerdict } from "./tickVerdict.js";

/**
 * The merge outcome this line counts as a failed merge: the cherry-pick that
 * would not land (`MergeOutcome`, `src/tickVerdict.ts`).
 *
 * The merge stage's own failure and no other, because the engine has already
 * drawn that line: a span this outcome names is what `TickVerdict.mergeFailures`
 * records, while a span whose gates reverted it after it landed is filed as a
 * gate failure (`GateFailure`, `src/tickVerdict.ts`) over a merge that
 * succeeded. Reading a gate revert or a tip-verify refusal into "failed
 * merge" here would re-draw that boundary on a reporting surface, where
 * nothing enforces it (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 */
const FAILED_MERGE_OUTCOME = "cherry-pick-conflict";

/** What every figure prints in place of a number it has no population for. */
const NOT_MEASURABLE = "not yet measurable";

/**
 * A wall-clock span at the coarsest unit that still states it — seconds,
 * minutes, hours, then days.
 *
 * Not `formatElapsed` (`src/budgetLine.ts`), which spells the same kind of
 * value for a different range: that line is a session's own clock and tops
 * out at hours, where a queue span is routinely days and would read as
 * `73h 5m`. Two ranges, two spellings, neither reaching past its own
 * surface.
 */
function formatSpan(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * The median of `values`, or `undefined` over none — the even case being the
 * mean of the two middles, which is what a median is over an even
 * population rather than a choice this line makes.
 *
 * A copy of the input is sorted, never the caller's array: the spans a figure
 * is folded from are read by more than this call.
 */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The span between a filing read in unix seconds and an instant in
 * milliseconds, or `undefined` when the pair is no span at all.
 *
 * Two readings are declined rather than folded into a number. An instant that
 * will not parse is a history line this engine cannot date — `Date.parse`
 * answers `NaN`, and arithmetic over it would carry silently into the median
 * as a `NaN` the whole figure then reads as. And a span that runs backwards is
 * a filing commit git timed after the ship that retired it, which is a host
 * clock that moved between the two writes rather than a queue that shipped
 * before it filed. Either way the pair is no measurement, and the figure says
 * what it was measured over (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
function spanFrom(filedAtSeconds: number, toMs: number): number | undefined {
  const ms = toMs - filedAtSeconds * 1000;
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * Every filing-to-ship span the verdict history and the filing times can both
 * date, in history order.
 *
 * A tag shipped twice over this history contributes two spans, both measured
 * from the one filing git holds for it: the filing read answers the *oldest*
 * add under the tag's own filename (`readFilingTimes`, `src/filingOrder.ts`),
 * so a tag that shipped, was filed again and shipped again measures its second
 * span from its first filing. The alternative — pairing each ship with the add
 * that preceded it — is a second reading of what a filing is, held on a
 * reporting surface against the one every selection orders by.
 */
function filingToShipSpans(
  verdicts: readonly TickVerdict[],
  filingTimes: FilingTimes,
): number[] {
  const spans: number[] = [];
  for (const verdict of verdicts) {
    const shippedAt = Date.parse(verdict.at);
    for (const tag of verdict.shippedTags) {
      const filedAt = filingTimes.get(tag);
      if (filedAt === undefined) continue;
      const span = spanFrom(filedAt, shippedAt);
      if (span !== undefined) spans.push(span);
    }
  }
  return spans;
}

/** How long each ready entry the filing times can date has been waiting at `now`. */
function readyWaits(
  ready: readonly PendingEntry[],
  filingTimes: FilingTimes,
  now: number,
): number[] {
  const waits: number[] = [];
  for (const entry of ready) {
    const filedAt = filingTimes.get(entry.tag);
    if (filedAt === undefined) continue;
    const span = spanFrom(filedAt, now);
    if (span !== undefined) waits.push(span);
  }
  return waits;
}

/** The three clauses, joined as one row of the listing. */
function flowRow(clauses: readonly string[]): string {
  return `flow: ${clauses.join("; ")}`;
}

/**
 * What `flume status` prints as the last row of its listing, from the two
 * histories it just read.
 *
 * `filingTimes` is `undefined` for a filing read that could not answer — a
 * cwd no repository holds, a repository with no commit yet, a ledger
 * relocated where git cannot name it. The two figures it feeds are withheld
 * and the row says so, rather than reading as a queue nothing has ever been
 * filed into: "no entry was ever filed" and "the filing read failed" are the
 * same number and opposite facts (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 *
 * `ready` is the gate switch's own verdict over the queue
 * (`gateReadyEntries`, `src/selection.ts`), and `now` is the instant the
 * waiting figure is measured to — the caller's, so the whole row is one
 * moment rather than one per clause.
 */
export function flowLine(opts: {
  verdicts: readonly TickVerdict[];
  ready: readonly PendingEntry[];
  filingTimes: FilingTimes | undefined;
  now: number;
}): string {
  // Both counts are over every verdict the history holds, filing times or
  // not: a ship the filing read cannot date is still a ship, and dividing the
  // failed merges by the timeable ships alone would inflate the rate by
  // exactly the spans the median already says it is missing.
  let ships = 0;
  let failedMerges = 0;
  for (const verdict of opts.verdicts) {
    ships += verdict.shippedTags.length;
    for (const row of verdict.mergeOutcomes) {
      if (row.outcome === FAILED_MERGE_OUTCOME) failedMerges += 1;
    }
  }
  const perShip = `failed merges per ship ${
    ships > 0 ? (failedMerges / ships).toFixed(2) : NOT_MEASURABLE
  }`;
  if (opts.filingTimes === undefined) {
    return flowRow([
      "filing times unreadable, so median filing→ship and longest ready " +
        "wait are withheld",
      perShip,
    ]);
  }
  const spans = filingToShipSpans(opts.verdicts, opts.filingTimes);
  const waits = readyWaits(opts.ready, opts.filingTimes, opts.now);
  const middle = median(spans);
  return flowRow([
    `median filing→ship ${middle === undefined ? NOT_MEASURABLE : formatSpan(middle)}`,
    `longest ready wait ${waits.length === 0 ? NOT_MEASURABLE : formatSpan(Math.max(...waits))}`,
    perShip,
  ]);
}
