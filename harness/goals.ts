/**
 * The queue's goals: every root `group` standing in it, in the operator's
 * order, with what still stands beneath each (`spec/harness.md`, *Goals and
 * decomposition*).
 *
 * One reading of the forest, with two readers. The drain that files and
 * re-ranks a goal is shown it as the block below; the order the package
 * serves the queue in sequences by it (`harness/order.ts`), because the
 * operator's rank is the queue's first key. A second reading spelled beside
 * this one would be the same steps answering differently
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * **No descent of its own.** Picking the goals out and walking what stands
 * beneath each are the engine's own readings of the forest it parsed
 * (`isGoal` and `subtreeOf`, `src/PendingSchema.ts`); what this module adds
 * is the rank — the operator's key, which the engine neither holds nor
 * orders by. A walk respelled here would answer differently from the
 * engine's the first time either grew a leg
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * **A derivation over the queue, not a second copy of it.** The tick already
 * carries every entry file's bytes in its queue listing, and this block adds
 * exactly what no eye reads off that listing reliably: the goals picked out of
 * the forest, sorted by the rank the operator set, each closed over its
 * descendants through the `parent` links. Tags and ranks only — no `files`, no
 * `acceptance`, nothing the listing already carries — so the block points at
 * entries rather than restating them (`.claude/rules/engineering.md`, *Derived
 * state is computed, never restated beside its source*).
 *
 * **Why the drain is the reader.** A goal is the operator's statement, filed
 * from a record and re-ranked from one, and the rank is the only rank the
 * queue carries — so the slice that drains the records is the one commit a
 * rank may move on, which the goal-rank gate holds it to (`harness/gates.ts`).
 * Two things it cannot decide without this block: whether a record's rank
 * collides with a goal already standing, and what work each goal still has
 * standing under it when a record asks where a finding belongs.
 *
 * The rank is read through the package's own field name rather than a literal
 * spelled here, so the declaration, the gate and this block name one field
 * (`GOAL_RANK_FIELD`, `harness/entryExtension.ts`).
 */

import {
  isGoal,
  subtreeOf,
  type PendingEntry,
  type SubtreeEntry,
} from "../src/PendingSchema.js";

import { GOAL_RANK_FIELD } from "./entryExtension.js";

/**
 * One goal standing in the queue: the root `group` itself, the rank it
 * carries, and every entry still standing beneath it, depth-first.
 *
 * `rank` is `undefined` for a root group carrying none — a queue the goal-rank
 * gate refuses at the commit that filed it, and one this block says out loud
 * rather than ordering by a number it chose itself
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
interface StandingGoal {
  readonly goal: PendingEntry;
  readonly rank: number | undefined;
  /** Every descendant still in the queue, depth-first, with its depth. */
  readonly remaining: readonly SubtreeEntry[];
}

/** The rank an entry carries, narrowed off the field the package declares. */
const rankOf = (entry: PendingEntry): number | undefined => {
  const value = entry[GOAL_RANK_FIELD];
  return typeof value === "number" ? value : undefined;
};

/**
 * Sibling order within a goal's subtree, and the tiebreak between two goals
 * at one rank: the tag, which is the one total key every entry carries.
 */
const byTag = (a: PendingEntry, b: PendingEntry): number =>
  a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;

/**
 * Every goal the queue carries, in the order the operator put them in: rank
 * ascending, a goal carrying no rank last, ties on the tag.
 *
 * The tag tiebreak is what makes this reading total for the same queue,
 * whatever order the entry files were listed in — two goals at one rank is a
 * collision the drain must resolve, and it cannot read a collision off a
 * listing whose order moves under it. The order the package serves the queue
 * in leans on the same totality: a wave's sequence may not move because a
 * directory listing came back differently (`harness/order.ts`).
 */
export function standingGoals(pending: readonly PendingEntry[]): StandingGoal[] {
  return pending
    .filter(isGoal)
    .map((goal) => ({
      goal,
      rank: rankOf(goal),
      // The descent is the engine's, ordered by the key this module chose
      // (`subtreeOf`, `src/PendingSchema.ts`): the depth each entry comes
      // back with is what the block nests by, and its termination over a
      // hand-built queue is that walk's guarantee rather than this one's.
      remaining: subtreeOf(pending, goal.tag, byTag),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        if (a.rank === undefined) return 1;
        if (b.rank === undefined) return -1;
        return a.rank - b.rank;
      }
      return byTag(a.goal, b.goal);
    });
}

/**
 * The goals block the drain is handed: one heading per goal in rank order,
 * each over the entries still standing beneath it, nested by depth.
 *
 * **A goal with nothing beneath it is said, never rendered as an empty
 * list** — otherwise the one state worth noticing reads as a goal whose
 * descendants the block failed to find (`.claude/rules/engineering.md`, *Loud
 * or nothing*).
 *
 * **And it is said as the fact alone, never as a verdict on it.** A goal whose
 * last descendant has shipped and a goal nobody has decomposed yet are the
 * same queue: both are a root `group` with nothing under it, and no reading of
 * the queue separates them. So the block states that nothing stands there and
 * stops; which of the two it is comes from the record that said the goal was
 * done, and retiring a goal the queue has finished is the ledger's own
 * (`spec/pending.md`, *The queue is a forest*). A block that named a cause
 * here would be inferring one from an absence
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * The count on each heading is `work` entries alone, because that is the unit
 * a goal's remaining work is counted in everywhere else the loop reports it
 * (`spec/cli.md`, *`flume status` owes exactly this*); the list beneath names
 * every descendant's own kind, so a `group` with no work under it is visible
 * rather than hidden behind a zero.
 */
export function goalsBlock(pending: readonly PendingEntry[]): string {
  const goals = standingGoals(pending);
  if (goals.length === 0) return "(no goal stands in the queue)";

  const lines = [
    `=== ${goals.length} standing goal(s), in rank order ===`,
  ];
  for (const { goal, rank, remaining } of goals) {
    const work = remaining.filter(({ entry }) => entry.kind === "work").length;
    const order =
      rank === undefined
        ? `no rank declared — only this slice may place one`
        : `rank ${rank}`;
    lines.push(
      `--- ${goal.tag} (${order}) — ${work} work entr${work === 1 ? "y" : "ies"} remaining ---`,
    );
    if (remaining.length === 0) {
      lines.push("(nothing stands beneath it in the queue)");
      continue;
    }
    for (const { entry, depth } of remaining) {
      lines.push(`${"  ".repeat(depth)}${entry.tag} (${entry.kind})`);
    }
  }
  return lines.join("\n");
}
