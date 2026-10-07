/**
 * The order the package serves the queue in (`Chain.order`, `src/Phase.ts`;
 * `spec/harness.md`, *The phases*): work under an operator's goal first, in
 * the goals' order, together with everything that work is `blockedBy`; then
 * work behind which the longest chain of other work waits; then oldest
 * filing; then tag.
 *
 * **A derivation over the context, not a second read of the queue.** Every
 * key comes off what the engine already handed the hook — the forest in
 * `OrderContext.queue`, the dependency edges in `OrderContext.blockedBy`, the
 * filing times in `OrderContext.filedAt` — so this module walks the graph the
 * engine resolved rather than resolving a second one beside it
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). The last two keys are the engine's own default
 * comparator, called rather than respelled (`byFilingThenTag`,
 * `src/filingOrder.ts`).
 *
 * **What is deliberately not a key.** Where an entry came from — which
 * producer filed it, which record it was drained from, which section it
 * cites — orders nothing. A downstream report is urgent because the operator
 * ranks the goal it sits under, and the only rank the queue carries is the
 * one a goal holds (`GOAL_RANK_FIELD`, `harness/entryExtension.ts`). An
 * order that read provenance would give every producer a channel for
 * urgency the operator never opened.
 */

import { byFilingThenTag } from "../src/filingOrder.js";
import type { PendingEntry } from "../src/PendingSchema.js";
import type { OrderContext } from "../src/Phase.js";

import { standingGoals } from "./goals.js";

/**
 * Where work under no goal sorts: behind every entry under one.
 *
 * A number rather than a separate arm, so the goal key is one subtraction —
 * and two of these on one comparison is caught by the equality that precedes
 * the subtraction, rather than reaching the not-a-number it would produce,
 * which the sort would read as a tie it is not.
 */
const UNGOALED = Number.POSITIVE_INFINITY;

/**
 * Each tag the goals claim → the position of the first goal that claims it.
 *
 * A goal claims its own subtree and, transitively through `blockedBy`,
 * everything that subtree is waiting on: a blocker standing outside the goal
 * is work the goal cannot ship without, so serving the goal while leaving its
 * upstream behind the rest of the queue would rank a goal nothing can
 * progress.
 *
 * Goals arrive in the operator's order ({@link standingGoals}), so the first
 * claim on a tag is the lowest-ranked goal that wants it and later goals
 * leave it where it is — which is how upstream two goals share is served with
 * the first of them rather than with the last to walk over it.
 */
function goalPlaces(ctx: OrderContext): ReadonlyMap<string, number> {
  const places = new Map<string, number>();

  standingGoals(ctx.queue).forEach(({ goal, remaining }, place) => {
    // Seeded with the goal's own subtree, then widened through the edges the
    // engine resolved. A growing frontier with its own seen set rather than a
    // recursive walk: `blockedBy` is a DAG's parent list, so one blocker is
    // reachable along many paths and the seen set is what keeps the widening
    // linear instead of exponential. Its cycle arm rides along for free, and
    // is what keeps this walk total on its own terms: a queue whose blockers
    // close on themselves is refused at the parse every order hook's graph
    // is composed from (`blockerCycleFrom`, `src/PendingSchema.ts`), so
    // acyclicity is that module's invariant rather than this walk's input
    // shape, and a loop that did reach here stops at the claims already
    // placed rather than hanging.
    const frontier = [goal.tag, ...remaining.map(({ entry }) => entry.tag)];
    const seen = new Set(frontier);
    for (let at = 0; at < frontier.length; at += 1) {
      const tag = frontier[at];
      if (tag === undefined) continue;
      if (!places.has(tag)) places.set(tag, place);
      for (const blocker of ctx.blockedBy.get(tag) ?? []) {
        if (seen.has(blocker)) continue;
        seen.add(blocker);
        frontier.push(blocker);
      }
    }
  });

  return places;
}

/**
 * Each tag → the length of the longest chain of `work` entries waiting behind
 * it, counted over the edges {@link OrderContext.blockedBy} carries.
 *
 * Critical-path list scheduling, in the one form the queue's own shape asks
 * for: shipping an entry frees whatever named it as a blocker, so the entry
 * with the longest line behind it is the one whose delay costs the most
 * sequencing. The count is `work` alone, because `work` is the dispatch unit
 * — a `group` or `step` on the path is walked through and contributes no
 * length (`spec/pending.md`, *The queue is a forest*).
 *
 * The memo is what the graph's shape asks for, as {@link goalPlaces}'s seen
 * set is: a blocker many entries wait on is measured once rather than once
 * per path into it. The open-frontier set beside it is the cycle arm alone,
 * and stands for the reason that walk's does — the parse refuses a
 * `blockedBy` cycle before any order hook is handed the graph
 * (`blockerCycleFrom`, `src/PendingSchema.ts`), so this is a walk kept total
 * against an invariant another module owns, and a loop that did reach it
 * terminates at the length measured so far rather than recurring.
 */
function dependentWork(ctx: OrderContext): ReadonlyMap<string, number> {
  const byTag = new Map(ctx.queue.map((entry) => [entry.tag, entry] as const));

  // The edges reversed once: a blocker's tag → the entries waiting on it.
  // `blockedBy` is keyed by the waiting entry, and what every key of this
  // measure needs is the other direction.
  const waiting = new Map<string, PendingEntry[]>();
  for (const [tag, blockers] of ctx.blockedBy) {
    const dependent = byTag.get(tag);
    if (dependent === undefined) continue;
    for (const blocker of blockers) {
      const held = waiting.get(blocker);
      if (held === undefined) waiting.set(blocker, [dependent]);
      else held.push(dependent);
    }
  }

  const lengths = new Map<string, number>();
  const open = new Set<string>();
  const measure = (tag: string): number => {
    const memo = lengths.get(tag);
    if (memo !== undefined) return memo;
    if (open.has(tag)) return 0;
    open.add(tag);
    let longest = 0;
    for (const dependent of waiting.get(tag) ?? []) {
      const through =
        (dependent.kind === "work" ? 1 : 0) + measure(dependent.tag);
      if (through > longest) longest = through;
    }
    open.delete(tag);
    lengths.set(tag, longest);
    return longest;
  };

  for (const tag of waiting.keys()) measure(tag);
  return lengths;
}

/**
 * The package's `Chain.order`: `ready` resequenced by goal, then by the work
 * waiting behind each entry, then by the engine's own default.
 *
 * A **permutation of what it was handed** by construction — a sorted copy of
 * `ready`, never a set this function composes — which is the one shape the
 * engine refuses a hook on (`orderedForSelection`, `src/selection.ts`).
 *
 * Pure and synchronous over the context, so the order a wave serves is
 * reproducible from the disk the selection was taken against.
 */
export function queueOrder(
  ready: readonly PendingEntry[],
  ctx: OrderContext,
): readonly PendingEntry[] {
  const places = goalPlaces(ctx);
  const waiting = dependentWork(ctx);
  const byDefault = byFilingThenTag(ctx.filedAt);

  return [...ready].sort((a, b) => {
    const ap = places.get(a.tag) ?? UNGOALED;
    const bp = places.get(b.tag) ?? UNGOALED;
    if (ap !== bp) return ap - bp;
    const aw = waiting.get(a.tag) ?? 0;
    const bw = waiting.get(b.tag) ?? 0;
    if (aw !== bw) return bw - aw;
    return byDefault(a, b);
  });
}
