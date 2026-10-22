/**
 * The queue's goals — the rows `flume status` prints just ahead of its flow
 * row (spec/cli.md, "`flume status` owes exactly this"): one row per goal
 * standing, in the order the queue serves them, each naming the first few of
 * the `work` the goal has left, counting the rest, and saying how long it has
 * stood.
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
 * these rows read positions out of it twice: a goal's place is the place of
 * its earliest ready work, so the listing cannot rank two goals differently
 * from the dispatch that will pick between them, and one goal's work is read
 * in the positions its own entries hold, so the entries a row names are the
 * ones that dispatch reaches first. Where that order could not be taken at
 * all, the rows say so and fall back to the queue's own default —
 * declared in the row rather than left looking like the served order
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */

import { byFilingThenTag, type FilingTimes } from "./filingOrder.js";
import { descendantsOf, isGoal, type PendingEntry } from "./PendingSchema.js";
import { formatSpan, spanFrom } from "./queueSpan.js";

/** What a row says in place of a position, for a goal with no ready work. */
const NOTHING_READY = "nothing ready";

/**
 * How many of a goal's remaining `work` entries one row names before it counts
 * the rest (spec/cli.md, "`flume status` owes exactly this").
 */
const NAMED_WORK = 3;

/** What one row is rendered from — one goal, read against one ready set. */
interface GoalRead {
  goal: PendingEntry;
  /**
   * Its remaining `work` entries, in the order they will be served — which is
   * what decides which of them the row names ({@link workClause}).
   */
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
 *
 * That subtree is ordered by the same positions the goals themselves are
 * ({@link byServedPosition}), because a row names only its first few entries
 * and the queue's own default would hand that bound a different three than the
 * one the chain's policy will serve.
 */
function readGoals(
  listing: readonly PendingEntry[],
  ready: readonly PendingEntry[],
  queueOrder: (a: PendingEntry, b: PendingEntry) => number,
  withheld: boolean,
): GoalRead[] {
  const readyAt = new Map(ready.map((entry, at) => [entry.tag, at] as const));
  const servedOrder = byServedPosition(
    (entry: PendingEntry) => readyAt.get(entry.tag),
    queueOrder,
    withheld,
  );
  return listing.filter(isGoal).map((goal) => {
    const work = descendantsOf(listing, goal.tag)
      .filter((entry) => entry.kind === "work")
      .sort(servedOrder);
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
 * The order one set is served in: each subject by the position `servedAt`
 * answers for it, the subjects it answers nothing for last, `fallback`
 * breaking every tie.
 *
 * Both sequences a row set states read this one comparator — the goals by
 * their earliest ready work, and a goal's remaining work by each entry's own
 * position — rather than spelling the same ordering twice over two subjects
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). Sharing
 * it is also what keeps a truncated row honest: the entries it names are the
 * first of the sequence the listing itself is ranked by.
 *
 * `withheld` is the selection whose order could not be taken. The positions
 * are then indexes into a set no policy ordered, so they decide nothing and
 * `fallback` decides the whole sequence — ranking by them would be serving an
 * order this read never computed. What survives either way is the
 * nothing-ready partition, because readiness is the gate switch's verdict
 * over each entry and not a property of the sequence they arrived in.
 */
function byServedPosition<T>(
  servedAt: (subject: T) => number | undefined,
  fallback: (a: T, b: T) => number,
  withheld: boolean,
): (a: T, b: T) => number {
  return (a, b) => {
    const at = servedAt(a);
    const bt = servedAt(b);
    if ((at === undefined) !== (bt === undefined)) return at === undefined ? 1 : -1;
    if (!withheld && at !== undefined && bt !== undefined && at !== bt)
      return at < bt ? -1 : 1;
    return fallback(a, b);
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

/**
 * What the row says about the work the goal has left: the entries the queue
 * serves first, by name, and a count of everything standing behind them.
 *
 * A decomposed goal's whole tag list is a row nobody reads — what a listing
 * line owes is what comes next and how much is left, not the inventory — so
 * the naming stops at {@link NAMED_WORK} and the remainder is a number. Which
 * entries fall inside that bound is the served order's answer
 * ({@link readGoals}) and never the queue listing's: naming three the
 * dispatcher will not reach for days would be a truncation that misreports
 * rather than one that summarizes.
 */
function workClause(work: readonly PendingEntry[]): string {
  if (work.length === 0) return "no work entry yet";
  const named = work.slice(0, NAMED_WORK).map((entry) => entry.tag);
  const unnamed = work.length - named.length;
  const names = `work ${named.join(", ")}`;
  return unnamed === 0 ? names : `${names} and ${unnamed} more`;
}

/** One goal's row: its position's mark, its remaining work, and its standing. */
function goalRow(
  read: GoalRead,
  filingTimes: FilingTimes | undefined,
  now: number,
): string {
  const clauses = [
    ...(read.servedAt === undefined ? [NOTHING_READY] : []),
    workClause(read.work),
    standingClause(read.goal.tag, filingTimes, now),
  ];
  return `goal ${read.goal.tag}: ${clauses.join("; ")}`;
}

/**
 * What `flume status` prints for the queue's goals — no row at all for a queue
 * carrying none, which is the whole of this listing's silence about goals.
 *
 * `listing` is the queue as the verb read it, every kind: the goals are its
 * root groups ({@link isGoal}, the engine's own reading of the two fields
 * that decide one) and their remaining work is found by descending it.
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
  // which is what a tie falls to and what both sequences — the goals, and the
  // work inside each row — fall to where the served order was withheld; the
  // engine's one comparator over a queue rather than a second one spelled for
  // this row. A filing read that failed leaves it the tag alone, which is the
  // same degrade that read's own relocated-ledger answer carries.
  const queueOrder = byFilingThenTag(opts.filingTimes ?? new Map());
  const withheld = opts.orderWithheld !== undefined;
  const goals = readGoals(opts.listing, opts.ready, queueOrder, withheld);
  if (goals.length === 0) return [];
  goals.sort(
    byServedPosition(
      (read: GoalRead) => read.servedAt,
      (a, b) => queueOrder(a.goal, b.goal),
      withheld,
    ),
  );
  const rows = goals.map((read) => goalRow(read, opts.filingTimes, opts.now));
  return opts.orderWithheld === undefined
    ? rows
    : [
        `goals: served order withheld — ${opts.orderWithheld}; these rows ` +
          "follow the queue's own default order instead",
        ...rows,
      ];
}
