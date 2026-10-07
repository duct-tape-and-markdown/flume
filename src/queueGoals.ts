/**
 * The queue's goals — the rows `flume status` prints just ahead of its flow
 * row (spec/cli.md, "`flume status` owes exactly this"): one row per goal
 * standing, in the order the queue serves them, each naming the `work` the
 * goal has left and how long it has stood.
 *
 * One job: fold a queue listing and the ready set it was read with into those
 * rows. Nothing here reads disk and nothing here is stored — a goal's rank is
 * its own entry's, its remaining work is the forest's, and its position is the
 * order the dispatcher would serve, so a stored row would be a second home
 * for three facts the queue already holds (`.claude/rules/engineering.md`,
 * *Derived state is computed, never restated beside its source*).
 *
 * The order is not computed here either. The ready set arrives in the order
 * one selection serves it (`servedReadyEntries`, `src/selection.ts`), and
 * these rows read positions out of it: a goal's place is the place of its
 * earliest ready work, so the listing cannot rank two goals differently from
 * the dispatch that will pick between them. Where that order could not be
 * taken at all, the rows say so and fall back to the queue's own default —
 * declared in the row rather than left looking like the served order
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */

import { byFilingThenTag, type FilingTimes } from "./filingOrder.js";
import { descendantsOf, type PendingEntry } from "./PendingSchema.js";
import { formatSpan, spanFrom } from "./queueSpan.js";

/** What a row says in place of a position, for a goal with no ready work. */
const NOTHING_READY = "nothing ready";

/**
 * Whether this entry is a goal: a **root `group`** — the one shape a goal is
 * filed as (`spec/pending.md`, *The queue is a forest*), read off the two
 * core fields the engine already parses. A `group` organizes rather than
 * dispatches, and a root one has no group above it to organize *it*.
 *
 * Never off a rank or a label. Where a goal ranks among the goals standing is
 * a consumer's own declared field, and an engine row keyed on it would be
 * reading a convention the engine never agreed to
 * (`.claude/rules/engine-boundary.md`, *Capability vs convention*); the order
 * these rows take is the one the dispatcher takes, which is the chain's
 * `order` over the structure the queue states.
 */
function isGoal(entry: PendingEntry): boolean {
  return entry.kind === "group" && entry.parent === undefined;
}

/** What one row is rendered from — one goal, read against one ready set. */
interface GoalRead {
  goal: PendingEntry;
  /** Its remaining `work` entries, in the queue's own order. */
  work: PendingEntry[];
  /**
   * Where the goal's earliest ready work sits in the set this read was taken
   * over, or `undefined` for a goal with none ready.
   *
   * A *position* only where that set is the order the queue serves; where the
   * order was withheld it is a membership test and nothing more, which is why
   * the comparator below stops reading it then.
   */
  servedAt: number | undefined;
}

/**
 * The goals of `listing`, each read against the ready set `servedAt` indexes.
 *
 * A goal's remaining work is its whole subtree's `work` entries, not its
 * direct children: the queue is a forest and an epic between a goal and its
 * work is ordinary shape, so the descent is the engine's own walk
 * (`descendantsOf`, `src/PendingSchema.ts`) rather than a child lookup that
 * would read a decomposed goal as empty.
 */
function readGoals(
  listing: readonly PendingEntry[],
  ready: readonly PendingEntry[],
  queueOrder: (a: PendingEntry, b: PendingEntry) => number,
): GoalRead[] {
  const readyAt = new Map(ready.map((entry, at) => [entry.tag, at] as const));
  return listing.filter(isGoal).map((goal) => {
    const work = descendantsOf(listing, goal.tag)
      .filter((entry) => entry.kind === "work")
      .sort(queueOrder);
    let servedAt: number | undefined;
    for (const entry of work) {
      const at = readyAt.get(entry.tag);
      if (at !== undefined && (servedAt === undefined || at < servedAt))
        servedAt = at;
    }
    return { goal, work, servedAt };
  });
}

/**
 * The order the rows print in: each goal by the position of its earliest
 * ready work, goals with nothing ready last, the queue's own default order
 * breaking every tie.
 *
 * `withheld` is the selection whose order could not be taken. The positions
 * are then indexes into a set no policy ordered, so they decide nothing and
 * the default order decides the whole sequence — ranking goals by them would
 * be serving an order this read never computed. What survives either way is
 * the nothing-ready partition, because readiness is the gate switch's verdict
 * over each entry and not a property of the sequence they arrived in.
 */
function byServedPosition(
  withheld: boolean,
  queueOrder: (a: PendingEntry, b: PendingEntry) => number,
): (a: GoalRead, b: GoalRead) => number {
  return (a, b) => {
    if ((a.servedAt === undefined) !== (b.servedAt === undefined))
      return a.servedAt === undefined ? 1 : -1;
    if (
      !withheld &&
      a.servedAt !== undefined &&
      b.servedAt !== undefined &&
      a.servedAt !== b.servedAt
    )
      return a.servedAt < b.servedAt ? -1 : 1;
    return queueOrder(a.goal, b.goal);
  };
}

/**
 * How long the goal has stood, or which fact stands in place of a span.
 *
 * Three readings, spelled apart. `filingTimes` absent is a read that failed —
 * the caller's own refusal to answer, so the clause withholds rather than
 * reporting a goal filed at no time. A tag the read answered nothing for is
 * one no commit has filed yet, which is a fact about the queue and not a
 * failure. And a pair that will not measure is a host clock that moved
 * (`spanFrom`, `src/queueSpan.ts`). Folding any of the three into "0s" would
 * print a goal filed this second (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
function standingClause(
  tag: string,
  filingTimes: FilingTimes | undefined,
  now: number,
): string {
  if (filingTimes === undefined) return "standing withheld";
  const filedAt = filingTimes.get(tag);
  if (filedAt === undefined) return "not yet filed in git";
  const span = spanFrom(filedAt, now);
  return span === undefined ? "standing unmeasurable" : `stood ${formatSpan(span)}`;
}

/** One goal's row: its position's mark, its remaining work, and its standing. */
function goalRow(
  read: GoalRead,
  filingTimes: FilingTimes | undefined,
  now: number,
): string {
  const clauses = [
    ...(read.servedAt === undefined ? [NOTHING_READY] : []),
    read.work.length === 0
      ? "no work entry yet"
      : `work ${read.work.map((entry) => entry.tag).join(", ")}`,
    standingClause(read.goal.tag, filingTimes, now),
  ];
  return `goal ${read.goal.tag}: ${clauses.join("; ")}`;
}

/**
 * What `flume status` prints for the queue's goals — no row at all for a queue
 * carrying none, which is the whole of this listing's silence about goals.
 *
 * `listing` is the queue as the verb read it, every kind: the goals are its
 * root groups and their remaining work is found by descending it.
 *
 * `ready` is the ready set in the order one selection serves it
 * (`servedReadyEntries`, `src/selection.ts`), and `orderWithheld` is the
 * reason there was no such order to take — a filing read that failed, a
 * chain's `order` that refused. Named rather than omitted, because a row set
 * printed in a fallback order and one printed in the served order are
 * indistinguishable to their reader, and the first is the one an operator must
 * not act on as the second.
 *
 * `filingTimes` is the same read the flow row folds (`flowLine`,
 * `src/queueFlow.ts`), `undefined` where it failed, and `now` is the instant
 * every standing span is measured to — the caller's, so one listing is one
 * moment rather than one per row.
 */
export function goalRows(opts: {
  listing: readonly PendingEntry[];
  ready: readonly PendingEntry[];
  orderWithheld?: string;
  filingTimes: FilingTimes | undefined;
  now: number;
}): string[] {
  // The queue's own default order (`byFilingThenTag`, `src/filingOrder.ts`),
  // which is what a tie between two goals falls to and what the whole sequence
  // falls to where the served order was withheld — the engine's one comparator
  // over a queue rather than a second one spelled for this row. A filing read
  // that failed leaves it the tag alone, which is the same degrade that read's
  // own relocated-ledger answer carries.
  const queueOrder = byFilingThenTag(opts.filingTimes ?? new Map());
  const goals = readGoals(opts.listing, opts.ready, queueOrder);
  if (goals.length === 0) return [];
  goals.sort(byServedPosition(opts.orderWithheld !== undefined, queueOrder));
  const rows = goals.map((read) => goalRow(read, opts.filingTimes, opts.now));
  return opts.orderWithheld === undefined
    ? rows
    : [
        `goals: served order withheld — ${opts.orderWithheld}; these rows ` +
          "follow the queue's own default order instead",
        ...rows,
      ];
}
