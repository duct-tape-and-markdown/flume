/**
 * Which standing prior-attempt records are refusals only a plan slice can
 * resolve, and which of those are keyed to an entry the queue still carries.
 *
 * **One question, one evidence, two readers.** The inbox slice's window
 * opens on it (`inboxWindow.ts`) and the default handoff's refusal leg
 * routes on it (`handoff.ts`), and both are handed the same pair of engine
 * facts — the queue and the record store — off whichever surface each is
 * reading: `TickContext.pending`/`priorAttempts` at the `shouldRun` consult,
 * `TickResult.pendingAfter`/`priorAttempts` at the handoff that follows. A
 * table beside either reader is how a mode comes to route to the inbox from
 * one surface and nowhere from the other (`.claude/rules/engineering.md`,
 * *The fix lands at the mechanism*).
 *
 * Nothing here re-derives an engine fact. The record's `mode` is the one the
 * engine stamped, and the key each record is looked up under is the engine's
 * own `entryAttemptKey` (`src/priorAttempts.ts`) — never the two halves of
 * that key respelled here (`.claude/rules/engineering.md`, *A fact the
 * engine holds is reported, never rediscovered*).
 */

import type { PendingEntry } from "../src/PendingSchema.js";
import { entryAttemptKey } from "../src/priorAttempts.js";
import type { PriorAttempt } from "../src/Prompt.js";

/**
 * Which prior-attempt modes are refusals only a plan slice can resolve.
 *
 * `clean-exit` is a build agent that looked and declined; `render-refused`
 * is a prompt that never resolved, so no agent ran at all. Both leave the
 * entry exactly as pickable as it was, and neither is a state the next wave
 * can move — for a walled render, forever, since nothing about the tree
 * changes between attempts. `not-shipped` is a commit that landed and passed
 * every gate which the consumer's own `shipped` predicate declined: the park,
 * whose reason is in the note the tick wrote. Waking the slice that drains
 * records is what puts each of them in front of the only phase that can drop,
 * re-scope, or answer the entry.
 *
 * The other three are not plan's. A `gate-revert` and a `platform-preempt`
 * are a reverted commit and a killed process, both worth retrying from the
 * same queue, and a build wave is what retries them. `tip-moved` is a span
 * discarded because its base stopped being an ancestor: the agent's work was
 * not at fault and the next wave starts from a live base, so it too is the
 * wave's.
 *
 * Exhaustive over `PriorAttempt["mode"]` by type, so a mode the engine adds
 * is a type error here and must be classified rather than defaulting to "not
 * a refusal". That union is `NoCommitMode` plus the two merge fates a record
 * can carry, so a no-commit mode the engine mints is caught here too.
 *
 * Module-local: both readers reach it through {@link standingRefusals}
 * below, so the classification has exactly one indexing site and no caller
 * can key it by a mode it decided for itself.
 */
const PLAN_RESOLVES_STANDING: Record<PriorAttempt["mode"], boolean> = {
  "clean-exit": true,
  "render-refused": true,
  "not-shipped": true,
  "gate-revert": false,
  "platform-preempt": false,
  "tip-moved": false,
};

/**
 * The standing prior-attempt records that are refusals only a plan slice can
 * resolve **and** are keyed to an entry the queue still carries.
 *
 * Keyed to a live entry is the whole test: a record whose entry has left the
 * queue outlived the work it was about, and routing on it would hold a slice
 * open on nothing. So the walk runs the queue's way — each queued entry
 * looked up under {@link entryAttemptKey}, which is the key the store's own
 * walk filed the record under. Reaching the record through that key rather
 * than re-spelling its two halves here is what keeps the keyspace and the
 * tag's slug one spelling: a caller that composed either itself would stop
 * routing the day the engine changed how it keys, silently, and over exactly
 * the records a wave is walling on. The keyspace comes with the key, which is
 * what keeps a stem the queue no longer carries from matching a live phase's
 * record (`spec/loop.md`, *No false signal*).
 *
 * The same set either way: the map holds one record per written identity, so
 * looking each queued entry up finds exactly the entry-keyspace records a
 * scan of the map's values would have kept.
 *
 * Both inputs are optional because both are optional on the context a window
 * render may be hand-built from (`TickFacts`, `sliceWindow.ts`). Absent, the
 * answer is the empty set — "no standing refusal" — which is what a reader
 * that was handed no store can truthfully say. Every dispatcher-built surface
 * carries both, so no live tick takes that arm.
 *
 * Returns the records themselves rather than a count or a verdict: the inbox
 * window's render marks exactly these, by object identity, so the liveness
 * leg and the marked block cannot come apart.
 */
export function standingRefusals(
  pending: readonly PendingEntry[] | undefined,
  priorAttempts: ReadonlyMap<string, PriorAttempt> | undefined,
): PriorAttempt[] {
  if (pending === undefined || priorAttempts === undefined) return [];
  return pending
    .map((entry) => priorAttempts.get(entryAttemptKey(entry)))
    .filter(
      (record): record is PriorAttempt =>
        record !== undefined && PLAN_RESOLVES_STANDING[record.mode],
    );
}
