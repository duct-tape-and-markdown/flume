/**
 * Selection — which entries of a queue a tick may pick, the batch a fanout
 * wave opens on, and the entry a freed slot pulls next.
 *
 * One derivation for every surface that asks: `runSingleton`'s pre-tick read
 * (`src/singletonTick.ts`), `runFanout`'s wave (`src/waveTick.ts`),
 * `render`'s preview and `TickResult.pickableAfter`'s post-tick
 * re-derivation (`src/Dispatcher.ts`). The run-scoped
 * quarantine hold, the claim a sibling tick holds on an entry in flight, the
 * chain's own declared per-entry refusal, and the file-overlap partition are
 * spelled here alone, so no two of those surfaces can disagree about what
 * "pickable" means at the moment each is taken
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * The queue's default order is not among them: it is a read of git before it
 * is a comparison, and the status flow figures want the same times, so it
 * lives at its own door (`byFilingThenTag`, `src/filingOrder.ts`) and every
 * selection here is taken over the queue *and* the times it was read with
 * ({@link SelectableQueue}). What *is* spelled here is the chain's own
 * sequencing policy over that default — one call site for `Chain.order`
 * (`src/Phase.ts`) and one home for the refusal that bounds it
 * ({@link orderedForSelection}), so no two reported sets can be in two
 * orders.
 *
 * The gate switch is not among them either, nor the climb through an entry's
 * ancestors that decides which gates answer for it: both live at the exported
 * read every consumer already takes it from (`isPickableNow`,
 * `src/PendingSchema.ts`), and this module hands it the queue this tick read.
 * The identity the hold and the refusal both key on is not this module's
 * either — an entry's declaration key has a second reader in the
 * prior-attempt record, so it lives at its own door (`entryDeclaredKey`,
 * `src/entryKey.ts`).
 */

import { entryClaimSlug } from "./entryClaims.js";
import { entryDeclaredKey } from "./entryKey.js";
import { byFilingThenTag, type FilingTimes } from "./filingOrder.js";
import { isDisjointFrom, partitionByFileOverlap } from "./partition.js";
import { isPickableNow, type PendingEntry } from "./PendingSchema.js";
import type { Chain, OrderContext, QuarantinedTag } from "./Phase.js";
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
 * {@link OrderContext.blockedBy} — the dependency edges still standing over
 * this queue, keyed by the entry that declares them.
 *
 * The membership read is the gate switch's own — an entry leaves the queue
 * when it ships, so a blocker tag `queued` no longer holds has settled
 * (`isPickableNow`, `src/PendingSchema.ts`) — and the edges are the tags it
 * still does hold. Computed here rather than by the policy that reads it:
 * the queue is what settles a blocker, and a chain re-walking it for the
 * fact the gate switch just resolved is the restatement the posture names
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 */
function blockedByGraph(
  pending: readonly PendingEntry[],
  queued: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const entry of pending) {
    if (entry.gate.kind !== "blockedBy") continue;
    graph.set(
      entry.tag,
      entry.gate.tags.filter((tag) => queued.has(tag)),
    );
  }
  return graph;
}

/**
 * The queue one selection is taken over: the entries a tick read, and when
 * each of them was filed.
 *
 * One value rather than two arguments, because they are one read — the order a
 * selection serves is a property of the queue it is taken over, and a caller
 * free to hand the entries of one world with the filing times of another would
 * be ordering a queue by a history it does not have
 * (`readPendingForDecision`, `src/pendingLedger.ts`).
 */
interface SelectableQueue {
  readonly pending: readonly PendingEntry[];
  /** `readFilingTimes`'s map (`src/filingOrder.ts`), for this queue's own tip. */
  readonly filingTimes: FilingTimes;
}

/**
 * Whether this entry is the dispatch unit — the `work` kind, which is the only
 * one selection offers (`spec/pending.md`, *The entry core*). A `step` is done
 * in its `work` entry's own session and a `group` organizes, so neither is a
 * tick's job however open its gate reads.
 *
 * Not folded into the gate switch (`isPickableNow`, `src/PendingSchema.ts`):
 * the gate is why an entry is held back and clears when its reason does, while
 * the kind is what the entry *is* — a group's gate being open is not a claim
 * that a session should take it.
 */
function isDispatchUnit(entry: PendingEntry): boolean {
  return entry.kind === "work";
}

/**
 * The entries the gate read clears, before this run's live quarantine is
 * applied.
 *
 * The queue goes through whole, as the one argument the exported read
 * resolves both of its queue-shaped facts from: which blockers have settled,
 * and which of this entry's ancestors still gate it (`isPickableNow`,
 * `src/PendingSchema.ts`). Nothing is composed for it here — a set of
 * settled tags assembled on this side would be selection holding a second
 * opinion about what a ship is, and the ancestor climb a second time.
 */
function gateEligible(
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean,
  capabilities: ReadonlySet<string>,
): PendingEntry[] {
  return pending.filter(
    (e) =>
      isDispatchUnit(e) &&
      isPickableNow(e, pending, isForkResolved, capabilities),
  );
}

/**
 * The ready set over a queue read with no tick around it: the gate switch's
 * own verdict over the `work` entries of `pending`, with nothing about a run
 * applied — no quarantine, no sibling's claim, no chain refusal.
 *
 * `flume status`'s flow figures are the consumer (`flowLine`,
 * `src/queueFlow.ts`): how long the oldest ready entry has been waiting is a
 * question about the queue at the moment of asking, and an observational verb
 * holds none of the three holds a wave's selection subtracts — this run's
 * quarantine is a supervisor's own memory, which no disk read reaches at all.
 * Shared from here rather than spelled a second time there, so "ready" is one
 * derivation on both surfaces (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*).
 *
 * `isForkResolved` defaults to always-resolved, as it does at the exported
 * gate read every other consumer takes this from (`isPickableNow`,
 * `src/PendingSchema.ts`): the foundations governor is a chain module's own
 * export, which the best-effort load an observational verb takes does not
 * carry (`loadChainForObservation`, `src/cliChainLoad.ts`). So a caller
 * passing none reads an entry gated on an unresolved fork as ready, which is
 * the declared cost of asking without a governor rather than a verdict about
 * the fork.
 */
export function gateReadyEntries(
  pending: readonly PendingEntry[],
  capabilities: ReadonlySet<string>,
  isForkResolved: (slug: string) => boolean = () => true,
): PendingEntry[] {
  return gateEligible(pending, isForkResolved, capabilities);
}

/**
 * {@link gateReadyEntries} in the order the queue serves it — the ready set a
 * selection would hand its first slot, read with no tick around it.
 *
 * `flume status`'s goal rows are the consumer (`goalRows`,
 * `src/queueGoals.ts`): a goal's place in that listing is the place of its
 * earliest ready work, and a verb that sorted the ready set itself would be a
 * second ordering free to disagree with the one dispatch serves. So the
 * question is asked here, where the chain's policy is applied for every other
 * surface ({@link orderedForSelection}), and the chain's declaration and the
 * `OrderContext` it reads stay inside this module — an observational caller
 * holds a queue and a chain, not a selection's facts.
 *
 * Carries nothing in flight, which is the empty list every selection but a
 * wave's own refill is handed (`OrderContext.inFlight`, `src/Phase.ts`): a
 * read taken outside a tick is carrying no entry by construction.
 *
 * `chain` is `undefined` where none loaded — the best-effort load an
 * observational verb takes (`loadChainForObservation`,
 * `src/cliChainLoad.ts`) — and the queue's own default order is then what it
 * serves. A chain whose policy refuses this set throws, as it does at every
 * other surface that reports one: the caller says what it withheld rather than
 * printing an order no policy returned.
 */
export function servedReadyEntries(opts: {
  pending: readonly PendingEntry[];
  /** When each of `pending` was filed — the default order's own input. */
  filingTimes: FilingTimes;
  chain: Chain | undefined;
}): PendingEntry[] {
  const ready = gateReadyEntries(
    opts.pending,
    new Set(opts.chain?.capabilities ?? []),
  ).sort(byFilingThenTag(opts.filingTimes));
  return orderedForSelection(opts.chain?.order, ready, {
    pending: opts.pending,
    queued: new Set(opts.pending.map((e) => e.tag)),
    filingTimes: opts.filingTimes,
    inFlight: [],
  });
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
interface EntryRefusalFacts {
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
 * The chain's declared sequencing policy applied to one selection's ready
 * set, or that set in the queue's own default order where the chain declared
 * none (`spec/chain.md`, "`Chain.order` — the queue's sequencing policy").
 *
 * The hook's one call site, and the one home of the refusal that bounds it.
 * Every surface that reports a pickable set reaches the declaration through
 * here, so none of them can serve an order another would not — and none can
 * serve a set the hook rewrote while looking like the queue.
 *
 * **The return is read as a sequence, never as a queue.** The permutation
 * check below is by tag, and the entries served are the engine's own reads in
 * the order those tags came back: a hook that copies or rewrites an entry on
 * the way through orders the queue, which is what it was asked for, and
 * cannot replace the declaration a tick is then dispatched against
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * A return that is not a permutation of `ready` throws, naming the hook and
 * the entries that differ. Selection runs before any worktree is created, so
 * the refusal reaches the tick ahead of every agent invocation it would have
 * opened — an order that silently drops work is starvation nobody sees, and
 * proceeding over it is the degradation `.claude/rules/engineering.md`,
 * *Loud or nothing* refuses.
 *
 * The context is composed here, past the undeclared arm: a chain that declared
 * no policy pays for no graph walk, and the facts the hook reads have one
 * assembly point rather than one per caller.
 */
function orderedForSelection(
  order: Chain["order"],
  ready: readonly PendingEntry[],
  over: {
    pending: readonly PendingEntry[];
    queued: ReadonlySet<string>;
    filingTimes: FilingTimes;
    inFlight: readonly PendingEntry[];
  },
): PendingEntry[] {
  if (!order) return [...ready];
  const ctx: OrderContext = {
    queue: over.pending,
    blockedBy: blockedByGraph(over.pending, over.queued),
    filedAt: over.filingTimes,
    inFlight: over.inFlight,
  };
  const handed = new Map(ready.map((e) => [e.tag, e] as const));
  const returned = order(ready, ctx);
  const seen = new Set<string>();
  const unknown: string[] = [];
  const repeated: string[] = [];
  for (const entry of returned) {
    if (!handed.has(entry.tag)) unknown.push(entry.tag);
    else if (seen.has(entry.tag)) repeated.push(entry.tag);
    seen.add(entry.tag);
  }
  const dropped = [...handed.keys()].filter((tag) => !seen.has(tag));
  if (unknown.length > 0 || repeated.length > 0 || dropped.length > 0) {
    const named = [
      ...(dropped.length > 0 ? [`dropped ${dropped.join(", ")}`] : []),
      ...(unknown.length > 0
        ? [`named ${unknown.join(", ")}, which it was not handed`]
        : []),
      ...(repeated.length > 0 ? [`repeated ${repeated.join(", ")}`] : []),
    ].join("; ");
    throw new Error(
      `chain's order hook (Chain.order) returned ${returned.length} ` +
        `entr${returned.length === 1 ? "y" : "ies"} over the ` +
        `${ready.length} it was handed: ${named}. Chain.order orders the ` +
        `ready set and never admits to it — return exactly the entries it ` +
        `was given, reordered.`,
    );
  }
  return returned.map((e) => handed.get(e.tag)!);
}

/**
 * The pickable set and the three holds that shrank it — what `gateEligible`
 * cleared, minus this run's live quarantine, minus the entries a sibling
 * tick holds a claim on, minus what the chain's own refusal declined, with
 * each hold named by the entries it took.
 *
 * `pickable` is in the order the chain declared ({@link orderedForSelection}),
 * which undeclared is the queue's own ({@link byFilingThenTag},
 * `src/filingOrder.ts`). All three hold lists are in the queue's own order
 * and stay there: the sequencing policy is handed the ready set alone, so an
 * entry a hold took was never offered to it.
 *
 * The one derivation `runSingleton`'s pre-tick selection, {@link selectBatch}
 * and `TickResult.pickableAfter`'s post-tick re-derivation all take, so no
 * two can disagree on what "pickable" means at the moment each is taken, nor
 * on which hold to blame for an entry missing from it.
 */
interface PickableSelection {
  /** Every entry the gate switch cleared that none of the three holds below took. */
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
 * One selection's whole request: the chain whose declarations govern it, and
 * the five facts about the moment it is taken at.
 *
 * Named here, beside the selection it describes, because two siblings hold the
 * same shape — the dispatcher's own bound selection and the callable a leg
 * reads off it (`TickLegContext.selection`, `src/tickLeg.ts`) — and a request
 * spelled twice is a vocabulary waiting to diverge
 * (`.claude/rules/engineering.md`, *A module is one job*). What the dispatcher
 * adds to it is its own two knobs: this run's quarantine and the parallelism
 * ceiling ({@link selectBatch}).
 */
export interface SelectionRequest {
  readonly chain: Chain;
  /** The entries and the filing times they were read with. */
  readonly queue: SelectableQueue;
  /** The foundations governor, resolved for this tick. */
  readonly isForkResolved: (slug: string) => boolean;
  /** What the chain's own per-entry refusal is judged against. */
  readonly refusalFacts: EntryRefusalFacts;
  /** The entry slugs a live claim stands on — see {@link pickableSelection}. */
  readonly claimedSlugs: ReadonlySet<string>;
  /** What this tick is carrying right now — `OrderContext.inFlight` (`src/Phase.ts`). */
  readonly inFlight: readonly PendingEntry[];
}

/**
 * {@link PickableSelection} over one queue. `refuses` is the chain's
 * predicate already bound to this tick's facts ({@link bindEntryRefusal}) —
 * required rather than optional, so a caller reaches the chain's declaration
 * through the one binding instead of quietly selecting without it.
 */
export function pickableSelection(opts: {
  pending: readonly PendingEntry[];
  /** When each of `pending` was filed — the default order's own input. */
  filingTimes: FilingTimes;
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
  /**
   * The chain's declared sequencing policy, `undefined` where it declared
   * none — `Chain.order` (`src/Phase.ts`) passed through as read, not an
   * optional field, so a caller selects *with* the declaration or names its
   * absence rather than quietly serving a default the chain replaced.
   */
  order: Chain["order"];
  /**
   * The entries this tick is carrying at the moment of this selection —
   * `OrderContext.inFlight` (`src/Phase.ts`). Required for the reason
   * `order` is: every selection but a wave's own refill carries nothing, and
   * that is a fact its caller states rather than one an omission implies.
   */
  inFlight: readonly PendingEntry[];
}): PickableSelection {
  // The queue's one ordering, taken once over the eligible set: the pickable
  // set below and all three hold lists are read off it in this order, so no
  // surface that reports one of them can order it differently. The order is
  // the queue's own default — this tick's filing times, and the tag beneath
  // them (`byFilingThenTag`, `src/filingOrder.ts`).
  // Every tag this queue holds — the membership the edge graph the order
  // hook is handed is read against ({@link blockedByGraph}). The gate read
  // takes the same fact off the queue it is handed, so neither side can hold
  // a second opinion about what this queue still carries.
  const queued = new Set(opts.pending.map((e) => e.tag));
  const eligible = gateEligible(
    opts.pending,
    opts.isForkResolved,
    opts.capabilities,
  ).sort(byFilingThenTag(opts.filingTimes));
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
    // The chain's policy over the set its own holds left standing, and the
    // default where it declared none: the hook sees the ready set alone, in
    // the queue's own order, with every engine hold already settled.
    pickable: orderedForSelection(opts.order, pickable, {
      pending: opts.pending,
      queued,
      filingTimes: opts.filingTimes,
      inFlight: opts.inFlight,
    }),
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
  /**
   * The width `batches` was capped at — the chain's declaration where it made
   * one, the caller's ceiling below it. Reported for the same reason
   * `partitionIgnore` is: a wave runs this many slots at once for its whole
   * life, refills included, and re-reading the chain beside the selection
   * would let the batch and the slot count disagree
   * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   * never rediscovered*).
   */
  maxParallel: number;
}

/**
 * The entry a freed fanout slot pulls: the first candidate, in the queue's own
 * order, whose touched paths are disjoint from every entry the wave is still
 * carrying (`isDisjointFrom`, `src/partition.ts`).
 *
 * The same read the batch partition makes, asked of a set no batch describes.
 * A wave's initial fill is `batches[0]`, and every slot freed after it pulls
 * against whatever is still in flight at that moment — which is a set the
 * partition could not have known, since it depends on the order the agents
 * finished in (`spec/worktrees.md`, *Fanout and worktrees — provisioning,
 * isolation, teardown*).
 *
 * `candidates` is the pickable remainder in the order this selection serves
 * ({@link orderedForSelection}); `undefined`
 * is "nothing left that this moment's in-flight set leaves room for", which a
 * wave reads as a slot it does not refill rather than as a drained queue.
 */
export function nextDisjointPick(opts: {
  candidates: readonly PendingEntry[];
  inFlight: readonly PendingEntry[];
  /** `BatchSelection.partitionIgnore`, so a refill collides on the list the batch did. */
  ignore: string[];
  /**
   * The listing the refill reads every footprint against — the live queue the
   * candidates came from, steps included, so a refill collides on the same
   * whole-session footprint the batch partition did (`PartitionOptions`,
   * `src/partition.ts`).
   */
  listing: readonly PendingEntry[];
}): PendingEntry | undefined {
  return opts.candidates.find((e) =>
    isDisjointFrom(e, opts.inFlight, {
      ignore: opts.ignore,
      listing: opts.listing,
    }),
  );
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
  /** When each of `pending` was filed — see {@link pickableSelection}. */
  filingTimes: FilingTimes;
  isForkResolved: (slug: string) => boolean;
  /** This run's live quarantine — `DispatcherOptions.quarantinedSlugs`, absent outside a supervised run. */
  quarantinedSlugs?: ReadonlySet<string>;
  /** The entry slugs a live claim stands on — see {@link pickableSelection}. */
  claimedSlugs?: ReadonlySet<string>;
  /** What this queue's entries are offered to the chain's own refusal with. */
  refusalFacts: EntryRefusalFacts;
  /** The dispatcher's own parallelism ceiling, below whatever the chain declares. */
  maxParallel: number;
  /** The entries this tick is carrying — see {@link pickableSelection}. */
  inFlight: readonly PendingEntry[];
}): BatchSelection {
  const { chain, pending, filingTimes, isForkResolved } = opts;
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
    filingTimes,
    isForkResolved,
    capabilities,
    ...(opts.quarantinedSlugs !== undefined
      ? { quarantinedSlugs: opts.quarantinedSlugs }
      : {}),
    ...(opts.claimedSlugs !== undefined
      ? { claimedSlugs: opts.claimedSlugs }
      : {}),
    refuses: bindEntryRefusal(chain, opts.refusalFacts),
    // The chain's sequencing policy as declared, and the set this selection
    // is taken beside: the batch below partitions the order the hook
    // returned, so the entry a wave carries first is the one the policy put
    // first (`spec/chain.md`, "`Chain.order` — the queue's sequencing
    // policy").
    order: chain.order,
    inFlight: opts.inFlight,
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
  const maxParallel = chain.supervisorPolicy?.maxParallel ?? opts.maxParallel;
  return {
    ...selected,
    batches: partitionByFileOverlap(pickable, {
      maxParallel,
      ignore: partitionIgnore,
      // The whole queue, not `pickable`: a step is no dispatch unit, so it is
      // never among the candidates, and its files reach the partition only
      // through the entry above it (`spec/pending.md`, *The queue is a
      // forest*).
      listing: pending,
    }),
    partitionIgnore,
    maxParallel,
  };
}
