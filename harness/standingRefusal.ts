/**
 * Which standing prior-attempt records are refusals a producer resolves, and
 * which of those are keyed to an entry the queue still carries.
 *
 * **One question, one table, two askers.** Whether a standing record is a
 * refusal only a producer can move is asked on both halves of the routing
 * decision: the wake set asks it to route the record to the drain
 * (`inboxWindow.ts`), and the package's per-entry refusal asks it to hold the
 * entry back until that drain answers (`defaultRefusesEntry`, `handoff.ts`).
 * One table answers, and {@link isStandingRefusal} is its one indexing site —
 * either surface spelling the classification for itself is how an entry comes
 * to be walled on one surface and re-picked on the other, or woken into a
 * drain with nothing to file, every tick, for as long as the record stands
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * The wake set asks it over whichever surface hands it the pair of engine
 * facts — the queue and the record store: `TickContext.pending`/
 * `priorAttempts` at the `shouldRun` consult, `TickResult.pendingAfter`/
 * `priorAttempts` off the window the default handoff builds for the tick that
 * follows (`handoff.ts`). The per-entry refusal asks it over the one record
 * the engine hands it, and adds the declaration key that scopes the wall to
 * the reconciliation it is waiting for — the one thing that surface asks and
 * this module does not.
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
 * Which prior-attempt modes are refusals a producer resolves — the modes the
 * cited section enumerates, and nothing beside them (`spec/harness.md`, *The
 * default `handoff`*).
 *
 * `clean-exit` is a build agent that ran, read the entry, and left no usable
 * commit: what it decided is a function of the entry it was handed, so
 * re-dispatching it against that same declaration buys the same decision at
 * full agent price. `not-shipped` is a commit that landed and passed every
 * gate which the consumer's own `shipped` predicate declined, which is plan's
 * for the park among them — the entry the tick could not do, whose reason is
 * in the note it wrote. Each is a producer's to drop, re-scope or answer, so
 * one standing holds the entry back from the next build wave *and* wakes the
 * slice that drains records, which is the only phase that can answer it.
 *
 * The mode alone does not settle `not-shipped`, which is why this table is
 * not the whole answer: the package's own predicate declines a continuation
 * on the same mode, and that one is build's ({@link isContinuation}).
 *
 * The other four are not a producer's. A `gate-revert` and a
 * `platform-preempt` are a reverted commit and a killed process, both worth
 * retrying from the same queue, and a build wave is what retries them.
 * `tip-moved` is a span discarded because its base stopped being an ancestor:
 * the agent's work was not at fault and the next wave starts from a live
 * base, so it too is the wave's. And a `render-refused` is a prompt whose
 * spans and hooks did not resolve against the environment — no agent ran, and
 * no producer was asked for anything.
 *
 * **The render wall is not this table's to declare.** A render that fails
 * identically every wave is a wall no build agent can move, and holding the
 * entry for a producer is one answer to it — but it is also nothing the drain
 * can file, and the enumeration this table answers names three refusals and
 * not this one. Walling it here is the package minting a fourth member of a
 * set the spec states; if that wall is wanted, it is stated where the
 * enumeration is.
 *
 * Exhaustive over `PriorAttempt["mode"]` by type, so a mode the engine adds
 * is a type error here and must be classified rather than defaulting either
 * way — to "not a refusal", which costs the drain a record it never sees, or
 * to "hand it to build again", which costs an invocation per tick for the
 * rest of the run. That union is `NoCommitMode` plus the two merge fates a
 * record can carry, so a no-commit mode the engine mints is caught here too.
 *
 * Module-local, and read at exactly one site: both askers reach it through
 * {@link isStandingRefusal} below, so neither can key it by a mode it decided
 * for itself.
 */
const RESOLVED_BY_A_PRODUCER: Record<PriorAttempt["mode"], boolean> = {
  "clean-exit": true,
  "not-shipped": true,
  "gate-revert": false,
  "platform-preempt": false,
  "render-refused": false,
  "tip-moved": false,
};

/**
 * Whether one standing record against one entry is a refusal a producer
 * resolves: its mode is one {@link RESOLVED_BY_A_PRODUCER} names, and it is
 * not the one `not-shipped` a build tick declared a continuation
 * ({@link isContinuation}).
 *
 * The whole classification, so that a surface asking it asks nothing else.
 * The queue walk below filters by it; the per-entry refusal calls it over the
 * record the engine handed it and adds only the declaration-key comparison
 * that is its own (`defaultRefusesEntry`, `handoff.ts`). Both facts it reads
 * are on the record — the mode the engine stamped and the footprint the
 * `shipped` predicate was handed — so no tree is read and neither asker can
 * answer from a second reading of a note path.
 */
export function isStandingRefusal(
  stateRoot: string,
  entry: PendingEntry,
  record: PriorAttempt,
): boolean {
  return (
    RESOLVED_BY_A_PRODUCER[record.mode] &&
    !isContinuation(stateRoot, entry, record)
  );
}

/**
 * The standing prior-attempt records that are refusals a producer resolves
 * **and** are keyed to an entry the queue still carries.
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
    return isStandingRefusal(stateRoot, entry, record) ? [record] : [];
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
 * could not do. Which is why it is read inside
 * {@link isStandingRefusal} rather than beside either asker.
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
function isContinuation(
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
