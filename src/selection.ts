/**
 * Selection — which entries of a queue a tick may pick, and the batch a
 * fanout wave carries off it.
 *
 * One derivation for every surface that asks: `runSingleton`'s pre-tick read
 * (`src/singletonTick.ts`), `runFanout`'s wave (`src/waveTick.ts`),
 * `render`'s preview and `TickResult.pickableAfter`'s post-tick
 * re-derivation (`src/Dispatcher.ts`). The queue's ordering, the run-scoped
 * quarantine hold, the claim a sibling tick holds on an entry in flight, the
 * chain's own declared per-entry refusal, and the file-overlap partition are
 * spelled here alone, so no two of those surfaces can disagree about what
 * "pickable" means at the moment each is taken
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * The gate switch is not among them: it lives at the exported read every
 * consumer already takes it from (`isPickableNow`, `src/PendingSchema.ts`),
 * and this module composes its `blockedBy` input off the queue and calls it.
 * The identity the hold and the refusal both key on is not this module's
 * either — an entry's declaration key has a second reader in the
 * prior-attempt record, so it lives at its own door (`entryDeclaredKey`,
 * `src/entryKey.ts`).
 */

import { entryClaimSlug } from "./entryClaims.js";
import { entryDeclaredKey } from "./entryKey.js";
import { partitionByFileOverlap } from "./partition.js";
import { isPickableNow, type PendingEntry } from "./PendingSchema.js";
import type { Chain, QuarantinedTag } from "./Phase.js";
import { entryAttemptKey } from "./priorAttempts.js";
import type { PriorAttempt } from "./Prompt.js";

/**
 * The entry-scoping half of every stage-failure record, filled from the
 * entry the failure is blamed on. One home for the `tag`/`quarantineKey`
 * pairing `StageFailureEntry` (`src/tickVerdict.ts`) types — a call site
 * that has the entry spreads this rather than rebuilding either half. The
 * key itself is the entry as declared (`entryDeclaredKey`,
 * `src/entryKey.ts`).
 */
export function blamedOn(entry: PendingEntry): {
  tag: string;
  quarantineKey: string;
} {
  return { tag: entry.tag, quarantineKey: entryDeclaredKey(entry) };
}

/**
 * The blocker tags this entry names that the queue no longer holds — the
 * `shippedTags` set {@link isPickableNow} reads, composed for the caller
 * whose fact is the pending list rather than a set of tags it watched ship.
 * An entry leaves the queue when it ships, so absence from `pending` *is*
 * the settled verdict.
 *
 * Only this entry's own blockers are answered, because they are every tag
 * the `blockedBy` arm asks about; an entry naming none contributes none.
 */
function settledBlockers(
  entry: PendingEntry,
  pending: readonly PendingEntry[],
): ReadonlySet<string> {
  if (entry.gate.kind !== "blockedBy") return new Set();
  const queued = new Set(pending.map((e) => e.tag));
  return new Set(entry.gate.tags.filter((tag) => !queued.has(tag)));
}

/**
 * Pickability in the fanout context — the same rule the exported tooling read
 * answers, taken against the queue this tick read.
 *
 * The switch over `gate.kind` is {@link isPickableNow}'s, and the foundations
 * governor that precedes it is too; neither is restated here. What the two
 * callers hold differently is one arm's input, so that is all this one
 * composes: tooling holds the tags it watched ship, selection holds the
 * queue, and {@link settledBlockers} turns the second into the first.
 *
 * `isForkResolved` and `capabilities` default as they do there, so a caller
 * that wires neither gets the same no-op checks.
 */
function isPickable(
  entry: PendingEntry,
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean = () => true,
  capabilities: ReadonlySet<string> = new Set(),
): boolean {
  return isPickableNow(
    entry,
    settledBlockers(entry, pending),
    isForkResolved,
    capabilities,
  );
}

/**
 * The queue's one ordering (`spec/pending.md`, *The entry core*): `priority`
 * descending, then tag ascending. A file listing, a producer's array, a
 * directory walk — whatever order a queue is read in, every selection below
 * takes this one, so the order a tick picks in is the entry's declaration and
 * never the order its file happened to arrive in.
 *
 * Tags compare by code unit rather than `localeCompare`, so the ordering is
 * the same on every host: `TAG_PATTERN` (`src/PendingSchema.ts`) admits ASCII
 * alone, where code-unit order *is* ascending, and a locale-sensitive collator
 * would make the queue's order a property of the machine reading it.
 */
function byQueueOrder(a: PendingEntry, b: PendingEntry): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
}

/** The entries `isPickable` clears, before this run's live quarantine is applied. */
function gateEligible(
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean,
  capabilities: ReadonlySet<string>,
): PendingEntry[] {
  return pending.filter((e) =>
    isPickable(e, pending, isForkResolved, capabilities),
  );
}

/** Whether this run's live quarantine holds the entry **as read** ({@link entryDeclaredKey}). */
function heldByQuarantine(
  entry: PendingEntry,
  quarantinedSlugs?: ReadonlySet<string>,
): boolean {
  return quarantinedSlugs?.has(entryDeclaredKey(entry)) ?? false;
}

/**
 * Whether another tick holds this entry's claim — keyed on the entry's slug,
 * which is the name its claim file carries (`entryClaimSlug`,
 * `src/entryClaims.ts`).
 *
 * Not the declaration key the quarantine reads: a claim stands over the entry
 * itself, so a producer that re-scoped it mid-flight must still find it
 * claimed (`spec/pending.md`, *Claims — an entry in flight is left alone*).
 */
function heldByClaim(
  entry: PendingEntry,
  claimedSlugs?: ReadonlySet<string>,
): boolean {
  return claimedSlugs?.has(entryClaimSlug(entry.tag)) ?? false;
}

/**
 * The facts a chain's declared `refusesEntry` (`src/Phase.ts`) is judged
 * against for one selection: every persisted prior-attempt record this tick
 * read, and the trunk tip it read them at.
 *
 * Taken as data rather than as a store to consult, because selection is
 * synchronous and both reads are already made by the leg that runs it — the
 * same two values a post-tick re-derivation takes afresh, which is what makes
 * `pickableAfter` a verdict about the world the handoff is about to route in.
 */
export interface EntryRefusalFacts {
  /** `PriorAttemptStore.readAll`'s map, keyed as `TickContext.priorAttempts` is. */
  priorAttempts: ReadonlyMap<string, PriorAttempt>;
  /** The trunk tip this selection is taken at. */
  headSha: string;
}

/**
 * The chain's declared per-entry refusal bound to one tick's facts, or a
 * predicate refusing nothing where the chain declared none.
 *
 * The binding's one home: every surface that takes a pickable set reaches the
 * chain's predicate through here, so none of them can compose the context
 * differently — in particular none can look a record up under a key the
 * store's own walk did not file it under (`entryAttemptKey`,
 * `src/priorAttempts.ts`).
 *
 * The record is passed only when one stands: an absent key is a first
 * attempt, and a `priorAttempt: undefined` on the context would read as a
 * record that failed to decode.
 *
 * The entry's own declaration key is composed here too, beside the record the
 * store stamped with one: a predicate comparing "is that record still about
 * this entry" gets both keys from the engine rather than deriving either
 * (`EntryRefusalContext.declaredAs`, `src/Phase.ts`).
 */
export function bindEntryRefusal(
  chain: Chain,
  facts: EntryRefusalFacts,
): (entry: PendingEntry) => boolean {
  const refuses = chain.refusesEntry;
  if (!refuses) return () => false;
  return (entry) => {
    const priorAttempt = facts.priorAttempts.get(entryAttemptKey(entry));
    return refuses({
      entry,
      ...(priorAttempt ? { priorAttempt } : {}),
      headSha: facts.headSha,
      declaredAs: entryDeclaredKey(entry),
    });
  };
}

/**
 * The pickable set and the two holds that shrank it — what `isPickable`
 * cleared, minus this run's live quarantine, minus what the chain's own
 * refusal declined, with each hold named by the entries it took. Every one of
 * the three is in the queue's own order ({@link byQueueOrder}).
 *
 * The one derivation `runSingleton`'s pre-tick selection, {@link selectBatch}
 * and `TickResult.pickableAfter`'s post-tick re-derivation all take, so no
 * two can disagree on what "pickable" means at the moment each is taken, nor
 * on which hold to blame for an entry missing from it.
 */
interface PickableSelection {
  /** Every entry the gate switch cleared that neither hold below took. */
  pickable: PendingEntry[];
  /**
   * Entries the gate switch would pick, but this run's live quarantine
   * drops anyway — key beside tag, so a chain's handoff can tell
   * "quarantined open" from "genuinely pickable" without re-deriving it,
   * and can see which read of the entry the hold stands under. Keyed on
   * the entry as read: an entry re-scoped on trunk hashes to a new key, so
   * the next tick picks it up without a relaunch.
   */
  quarantinedTags: QuarantinedTag[];
  /**
   * Entries another tick holds a claim on, by tag — the set this selection
   * read off the claims directory, in the queue's own order
   * (`spec/pending.md`, *Claims — an entry in flight is left alone*).
   *
   * Reported for the reason `quarantinedTags` is: an entry in flight is still
   * `open` in the queue on disk, so a chain reading a shrunken pickable set
   * cannot otherwise tell "someone is building it" from "the gate switch
   * turned it down". Named by tag, because the tag is what a producer's
   * prompt renders and what its queue edits are addressed by; the slug the
   * file is named by is the engine's own key and stays inside it.
   */
  claimedTags: string[];
  /**
   * Entries the chain's own `refusesEntry` (`src/Phase.ts`) declined, by tag.
   * An entry the quarantine or a sibling's claim already took is never
   * offered to the predicate and so is named above alone: the engine's own
   * holds are answered first, and a chain is asked about entries it could
   * otherwise have.
   */
  refusedTags: string[];
}

/**
 * {@link PickableSelection} over one queue. `refuses` is the chain's
 * predicate already bound to this tick's facts ({@link bindEntryRefusal}) —
 * required rather than optional, so a caller reaches the chain's declaration
 * through the one binding instead of quietly selecting without it.
 */
export function pickableSelection(opts: {
  pending: readonly PendingEntry[];
  isForkResolved: (slug: string) => boolean;
  capabilities: ReadonlySet<string>;
  /** This run's live quarantine — `DispatcherOptions.quarantinedSlugs`, absent outside a supervised run. */
  quarantinedSlugs?: ReadonlySet<string>;
  /**
   * The entry slugs a live claim stands on, as the caller read them off disk
   * for this selection (`EntryClaimStore.readLive`, `src/entryClaims.ts`).
   * Absent is the empty set — a caller with no store to read, which is a
   * hand-built selection and never a tick.
   */
  claimedSlugs?: ReadonlySet<string>;
  refuses: (entry: PendingEntry) => boolean;
}): PickableSelection {
  // The queue's one ordering, taken once over the eligible set: the pickable
  // set below and both hold lists are read off it in this order, so no
  // surface that reports one of them can order it differently.
  const eligible = gateEligible(
    opts.pending,
    opts.isForkResolved,
    opts.capabilities,
  ).sort(byQueueOrder);
  // One consult per entry offered, partitioned in the same pass: the
  // predicate is the chain's code, and asking it twice about one entry both
  // pays for it twice and lets two answers disagree inside one selection.
  const pickable: PendingEntry[] = [];
  const refused: PendingEntry[] = [];
  const claimed: PendingEntry[] = [];
  for (const e of eligible) {
    if (heldByQuarantine(e, opts.quarantinedSlugs)) continue;
    // An entry in flight is skipped exactly as a quarantined one is, and
    // ahead of the chain's own predicate: it is the engine's hold, and a
    // chain asked about an entry it cannot be handed would be answering
    // about a tick that is not going to happen.
    if (heldByClaim(e, opts.claimedSlugs)) {
      claimed.push(e);
      continue;
    }
    (opts.refuses(e) ? refused : pickable).push(e);
  }
  return {
    pickable,
    quarantinedTags: eligible
      .filter((e) => heldByQuarantine(e, opts.quarantinedSlugs))
      .map((e) => ({ tag: e.tag, key: entryDeclaredKey(e) })),
    claimedTags: claimed.map((e) => e.tag),
    refusedTags: refused.map((e) => e.tag),
  };
}

/**
 * What {@link selectBatch} answered: the {@link PickableSelection} this queue
 * yields — the set standing, and each hold that shrank it — the batch
 * arithmetic over that set, and the one fact a caller would otherwise re-read
 * off the chain. Named because the wave that runs the selection and the leg
 * context that carries it (`src/tickLeg.ts`) both hold one in a variable.
 */
export interface BatchSelection extends PickableSelection {
  batches: PendingEntry[][];
  /**
   * The globs `batches` was partitioned under — reported rather than
   * re-read by a caller, so the footprint recorder filters through exactly
   * the list the partition collided on.
   */
  partitionIgnore: string[];
}

/**
 * The batch a fanout tick would carry off this queue, and the selection
 * facts it is drawn from — one derivation for `runFanout`, which runs the
 * wave, and `render`, which previews it. The two `supervisorPolicy` reads
 * are spelled here alone, so a preview and the tick it previews cannot
 * disagree about which entry goes first
 * (.claude/rules/engineering.md, "A module is one job").
 *
 * `batches` is empty exactly when `pickable` is; both callers answer that
 * case in their own vocabulary before reading a batch.
 */
export function selectBatch(opts: {
  chain: Chain;
  pending: readonly PendingEntry[];
  isForkResolved: (slug: string) => boolean;
  /** This run's live quarantine — `DispatcherOptions.quarantinedSlugs`, absent outside a supervised run. */
  quarantinedSlugs?: ReadonlySet<string>;
  /** The entry slugs a live claim stands on — see {@link pickableSelection}. */
  claimedSlugs?: ReadonlySet<string>;
  /** What this queue's entries are offered to the chain's own refusal with. */
  refusalFacts: EntryRefusalFacts;
  /** The dispatcher's own parallelism ceiling, below whatever the chain declares. */
  maxParallel: number;
}): BatchSelection {
  const { chain, pending, isForkResolved } = opts;
  // The environment facts this chain asserts, matched against each entry's
  // `requiresCapability` gate.
  const capabilities = new Set(chain.capabilities ?? []);
  // A slug the supervisor quarantined earlier this run (its worktree
  // provisioning failed on a prior tick) is dropped here — the queue
  // itself is untouched, so a fresh run/process retries it from scratch. An
  // entry a sibling tick holds a claim on is dropped beside it, for the
  // window that tick is carrying it. The chain's own per-entry refusal is
  // answered after both, over the entries they left standing.
  const selected = pickableSelection({
    pending,
    isForkResolved,
    capabilities,
    ...(opts.quarantinedSlugs !== undefined
      ? { quarantinedSlugs: opts.quarantinedSlugs }
      : {}),
    ...(opts.claimedSlugs !== undefined
      ? { claimedSlugs: opts.claimedSlugs }
      : {}),
    refuses: bindEntryRefusal(chain, opts.refusalFacts),
  });
  const { pickable } = selected;
  // spec/pending.md "Fanout partition — disjoint touched paths":
  // `partitionIgnore` narrows the collision set only — `declaredPaths`
  // (fence, write guard, ship detection) is untouched. Both knobs are
  // chain-overridable defaults (.claude/rules/engine-boundary.md's
  // policy-constant rule); `chain` is this tick's freshly-resolved chain,
  // so reading its declaration at the point of use is byte-identical to a
  // per-run bind.
  const partitionIgnore = chain.supervisorPolicy?.partitionIgnore ?? [];
  return {
    ...selected,
    batches: partitionByFileOverlap(pickable, {
      maxParallel: chain.supervisorPolicy?.maxParallel ?? opts.maxParallel,
      ignore: partitionIgnore,
    }),
    partitionIgnore,
  };
}
