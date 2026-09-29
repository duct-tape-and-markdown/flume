/**
 * Which standing prior-attempt records are refusals a producer resolves, and
 * which of those are keyed to an entry the queue still carries and no build
 * tick holds.
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
 * The wake set asks it over whichever surface hands it the facts a drain's
 * set is drawn from — the queue, the record store and the claims a build wave
 * is holding: `TickContext.pending`/`priorAttempts`/`claimed` at the
 * `shouldRun` consult, `TickResult.pendingAfter`/`priorAttempts`/`claimedTags`
 * off the window the default handoff builds for the tick that follows
 * (`handoff.ts`). The per-entry refusal asks it over the one record
 * the engine hands it. Neither asks anything beside it — **the declaration
 * key is inside the classification**, not a leg one surface adds: keyed on
 * the tag slug alone, the wake leg stays live over a record whose entry a
 * producer already rewrote, and wakes the drain every tick with nothing left
 * to reconcile, while the wall the same record used to hold has lifted.
 *
 * Nothing here re-derives an engine fact. The record's `mode` is the one the
 * engine stamped, its `touchedPaths` are the list the `shipped` predicate was
 * handed, the key each record is looked up under is the engine's own
 * `entryAttemptKey` and the declaration each is compared against is the
 * engine's own `entryDeclaredKey` (`src/priorAttempts.ts`, `src/entryKey.ts`)
 * — never the halves of either respelled here
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). What the package's own
 * vocabulary adds is where its build tick was told to say which put-down it
 * meant, and that spelling comes from `putDown.ts` rather than from a second
 * `includes` here.
 */

import { entryDeclaredKey } from "../src/entryKey.js";
import type { PendingEntry } from "../src/PendingSchema.js";
import { entryAttemptKey } from "../src/priorAttempts.js";
import type { PriorAttempt } from "../src/Prompt.js";

import type { SliceWindow } from "./handoff.js";
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
 * resolves: its mode is one {@link RESOLVED_BY_A_PRODUCER} names, it stands
 * against the entry **as the queue now declares it**, and it is not the one
 * `not-shipped` a build tick declared a continuation ({@link isContinuation}).
 *
 * The whole classification, so that a surface asking it asks nothing else.
 * The queue walk below filters by it; the per-entry refusal calls it over the
 * record the engine handed it and adds nothing (`defaultRefusesEntry`,
 * `handoff.ts`).
 *
 * **The declaration key is a leg of the classification, not of one asker.**
 * A refusal is a producer's to answer, so it lifts on exactly that answer: a
 * rewrite hashes to a new key and a drop takes the record with the entry.
 * Both surfaces are waiting on the same reconciliation, so both lift on it —
 * asked on the wall alone, the drain kept being woken for a record the queue
 * no longer had anything to reconcile against, which is the tick that runs
 * and files nothing (`spec/harness.md`, *The phases*). The key is the
 * engine's on both sides: {@link entryDeclaredKey} over the entry the caller
 * is holding, against the one the writer stamped on the record from the same
 * derivation (`priorAttemptRef`, `src/priorAttempts.ts`). A record the store
 * wrote under the entry keyspace always carries one, and one that does not is
 * read as absent before it reaches here (`PriorAttempt.declaredAs`,
 * `src/Prompt.ts`).
 *
 * Every other fact it reads is on the record — the mode the engine stamped
 * and the footprint the `shipped` predicate was handed — so no tree is read
 * and neither asker can answer from a second reading of a note path.
 */
export function isStandingRefusal(
  stateRoot: string,
  entry: PendingEntry,
  record: PriorAttempt,
): boolean {
  return (
    RESOLVED_BY_A_PRODUCER[record.mode] &&
    record.declaredAs === entryDeclaredKey(entry) &&
    !isContinuation(stateRoot, entry, record)
  );
}

/**
 * The standing prior-attempt records that are refusals a producer resolves
 * **and** are keyed to an entry the queue still carries.
 *
 * Keyed to a live entry is half the test: a record whose entry has left the
 * queue outlived the work it was about, and routing on it would hold a slice
 * open on nothing. The declaration the entry still carries is the other half,
 * and it is {@link isStandingRefusal}'s — a rewrite outlives a record exactly
 * as a drop does, and only one of the two takes the record off the map. So
 * the walk runs the queue's way — each queued entry
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
 * The three facts past it arrive as the surface each reader already holds,
 * never splayed beside it: `SliceWindow` at the liveness leg (`handoff.ts`)
 * and `WindowContext` at the render (`sliceWindow.ts`) both carry exactly this
 * `Pick`, so each caller passes its window whole and a transposed or forgotten
 * arm is unspellable rather than merely typed. Each is optional because each
 * is optional on those surfaces. Absent, a queue or a store makes the answer
 * the empty set — "no standing refusal" — which is what a reader that was
 * handed no store can truthfully say, and an absent `claimed` reads as nothing
 * in flight, the answer that withholds nothing. Every dispatcher-built surface
 * carries all three, so no live tick takes those arms.
 *
 * **A claimed entry's refusal is withheld, and left standing.** `claimed` is
 * the tags a tick read off the claims directory before it selected
 * (`TickContext.claimed`) — the same set the record leg withholds that
 * entry's note and park under (`recordFiles`, `records.ts`). A record whose
 * entry a build tick is carrying is one the drain may not answer: dropping or
 * re-scoping that entry is the rug the claim check exists to refuse
 * (`spec/pending.md`, *A claim covers the entry's records*), so the walk skips
 * it and the record keeps standing for the drain that follows the claim
 * lifting. Withheld inside the walk rather than beside either reader, because
 * the liveness leg and the marked block both read this one set — asked at one
 * of them alone, a claimed entry's park wakes the drain every cycle and the
 * block that drain is handed marks a record only its holder may touch.
 *
 * **The per-entry wall is not withheld with it** (`defaultRefusesEntry`,
 * `handoff.ts`), which is why the claim is a leg of this walk and not of the
 * classification: that surface asks {@link isStandingRefusal} over the one
 * record the engine handed it, and a claim is a tick in flight rather than a
 * producer's answer, so nothing about one lifts a wall — the engine's own
 * selection is what leaves a claimed entry alone (`spec/pending.md`, *Claims —
 * an entry in flight is left alone*).
 *
 * Returns the records themselves rather than a count or a verdict: the inbox
 * window's render marks exactly these, by object identity, so the liveness
 * leg and the marked block cannot come apart.
 */
export function standingRefusals(
  stateRoot: string,
  window: Pick<SliceWindow, "pending" | "priorAttempts" | "claimed">,
): PriorAttempt[] {
  const { pending, priorAttempts, claimed } = window;
  if (pending === undefined || priorAttempts === undefined) return [];
  const held = new Set(claimed ?? []);
  return pending.flatMap((entry) => {
    if (held.has(entry.tag)) return [];
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
