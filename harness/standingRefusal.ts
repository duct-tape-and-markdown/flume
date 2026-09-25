/**
 * Which standing prior-attempt records are refusals only a plan slice can
 * resolve, and which of those are keyed to an entry the queue still carries.
 *
 * **One question, one reader, two surfaces.** The inbox slice's window is
 * the only thing that asks it (`inboxWindow.ts`), and it asks the same way
 * whichever surface hands it the pair of engine facts — the queue and the
 * record store: `TickContext.pending`/`priorAttempts` at the `shouldRun`
 * consult, `TickResult.pendingAfter`/`priorAttempts` off the window the
 * default handoff builds for the tick that follows (`handoff.ts`). A second
 * classifier beside either surface is how a mode comes to route to the inbox
 * from one and nowhere from the other (`.claude/rules/engineering.md`, *The
 * fix lands at the mechanism*).
 *
 * **The park/continuation split has a second reader, and so is exported.**
 * Which declined ship is a park is the same question on both halves of the
 * routing decision: the wake set asks it to route the record to the drain,
 * and the per-entry refusal asks it to hold the entry back until the drain
 * answers ({@link isContinuation}, `handoff.ts`). One of the two spelling it
 * for itself is how an entry comes to be walled on one surface and re-picked
 * on the other, every tick, for as long as the park stands.
 *
 * Nothing here re-derives an engine fact. The record's `mode` is the one the
 * engine stamped, its `touchedPaths` are the list the `shipped` predicate was
 * handed, and the key each record is looked up under is the engine's own
 * `entryAttemptKey` (`src/priorAttempts.ts`) — never the two halves of
 * that key respelled here (`.claude/rules/engineering.md`, *A fact the
 * engine holds is reported, never rediscovered*). What the package's own
 * vocabulary adds is where its build tick was told to say which put-down it
 * meant, and that spelling comes from `putDown.ts` rather than from a second
 * `includes` here.
 */

import type { PendingEntry } from "../src/PendingSchema.js";
import { entryAttemptKey } from "../src/priorAttempts.js";
import type { PriorAttempt } from "../src/Prompt.js";

import { declaredPutDown } from "./putDown.js";

/**
 * Which prior-attempt modes are refusals only a plan slice can resolve.
 *
 * `clean-exit` is a build agent that looked and declined; `render-refused`
 * is a prompt that never resolved, so no agent ran at all. Both leave the
 * entry exactly as pickable as it was, and neither is a state the next wave
 * can move — for a walled render, forever, since nothing about the tree
 * changes between attempts. `not-shipped` is a commit that landed and passed
 * every gate which the consumer's own `shipped` predicate declined, which is
 * plan's for the park among them — the entry the tick could not do, whose
 * reason is in the note it wrote. Waking the slice that drains records is
 * what puts each of them in front of the only phase that can drop, re-scope,
 * or answer the entry.
 *
 * The mode alone does not settle `not-shipped`, which is why this table is
 * not the whole answer: the package's own predicate declines a continuation
 * on the same mode, and that one is build's ({@link isContinuation}).
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
 * `stateRoot` is the state root as the repository addresses it, which is the
 * alphabet a commit's touched paths arrive in and the one the notes are
 * composed in — required, because a window reading a footprint against a note
 * path has no safe default for where that note lives and a guess would
 * misclassify every consumer whose state root is not the guessed one.
 *
 * Both queue inputs are optional because both are optional wherever a reader
 * is handed them — `SliceWindow` at the liveness leg (`handoff.ts`),
 * `WindowContext` at the render (`sliceWindow.ts`). Absent, the answer is the
 * empty set — "no standing refusal" — which is what a reader
 * that was handed no store can truthfully say. Every dispatcher-built surface
 * carries both, so no live tick takes that arm.
 *
 * Returns the records themselves rather than a count or a verdict: the inbox
 * window's render marks exactly these, by object identity, so the liveness
 * leg and the marked block cannot come apart.
 */
export function standingRefusals(
  stateRoot: string,
  pending: readonly PendingEntry[] | undefined,
  priorAttempts: ReadonlyMap<string, PriorAttempt> | undefined,
): PriorAttempt[] {
  if (pending === undefined || priorAttempts === undefined) return [];
  return pending.flatMap((entry) => {
    const record = priorAttempts.get(entryAttemptKey(entry));
    if (record === undefined) return [];
    return PLAN_RESOLVES_STANDING[record.mode] &&
      !isContinuation(stateRoot, entry, record)
      ? [record]
      : [];
  });
}

/**
 * Whether a standing record is a **continuation** — the one `not-shipped`
 * that is nothing for a plan slice to reconcile, and the one a build wave may
 * carry on from (`spec/harness.md`, *A tick puts work down*).
 *
 * The package's `shipped` predicate declines a landed commit on two different
 * statements, and they route opposite ways: a park is the entry the tick
 * could not do, which only plan can drop, re-scope or answer; a continuation
 * is a green segment of an entry whose rest is another *build* tick's, with
 * nothing in it plan has to read. Classifying both by the mode they share
 * wakes the drain on the second with nothing to reconcile, every tick, for as
 * long as the entry takes — and, on the other surface, hands the *first*
 * straight back to a build wave that will read exactly what the last one
 * could not do (`defaultRefusesEntry`, `handoff.ts`).
 *
 * Which one it was is **on the record**, never re-derived: `touchedPaths` is
 * the same list the predicate itself was handed (`buildNotShipped`,
 * `src/priorAttempts.ts`), and where a tick wrote is the whole declaration,
 * read through the one spelling of those paths (`putDown.ts`). The span's
 * tree is not asked, because the record answers what it would: a commit that
 * *removed* a continuation is the tick that finished its entry, and that
 * commit shipped, so no `not-shipped` record was ever written for it.
 *
 * **A predicate that threw declared nothing.** `threw` is the engine's own
 * account of a hook that never reached a verdict, so whatever that commit
 * touched is not a reading this may take past it — a broken `shipped` is
 * exactly what the drain exists to be shown (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 *
 * **A footprint the writer elided reads as the park.** `touchedPaths` is
 * bounded, so a commit wide enough to push its note past that bound is
 * classified as the kind that wakes the drain — the safe direction of a fact
 * the record no longer carries, and one the drain can see for itself, since
 * the record states its own `omittedPaths` and renders whole into the prompt
 * (`inboxWindow.ts`).
 */
export function isContinuation(
  stateRoot: string,
  entry: PendingEntry,
  record: PriorAttempt,
): boolean {
  return (
    record.mode === "not-shipped" &&
    record.threw === undefined &&
    declaredPutDown(stateRoot, entry, record.touchedPaths) === "continuing"
  );
}
