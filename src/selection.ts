/**
 * Selection — which entries of a queue a tick may pick, and the batch a
 * fanout wave carries off it.
 *
 * One derivation for every surface that asks: `runSingleton`'s pre-tick read
 * (`src/singletonTick.ts`), `runFanout`'s wave (`src/waveTick.ts`),
 * `render`'s preview and `TickResult.pickableAfter`'s post-tick
 * re-derivation (`src/Dispatcher.ts`). The gate switch, the
 * run-scoped quarantine hold, the chain's own declared per-entry refusal, and
 * the file-overlap partition are spelled here
 * alone, so no two of those surfaces can disagree about what "pickable" means
 * at the moment each is taken (`.claude/rules/engineering.md`, *A module is
 * one job*).
 */

import { createHash } from "node:crypto";

import { partitionByFileOverlap } from "./partition.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Chain, QuarantinedTag } from "./Phase.js";
import { slugify } from "./paths.js";
import { entryAttemptKey } from "./priorAttempts.js";
import type { PriorAttempt } from "./Prompt.js";

/** Hex width of the entry-bytes half of a {@link quarantineKey}. */
const QUARANTINE_KEY_HASH_LENGTH = 10;

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort": the
 * run-scoped quarantine key for one entry **as read** — its slug and a hash
 * of its bytes in `pending.json`, joined `slug@hash`.
 *
 * The hash covers the entry's whole parsed shape, so any edit to it — a
 * re-scoped `files`, a widened `summary`, a changed gate — yields a new key
 * and lifts a hold the old key still carries, with no stop-and-relaunch (a
 * slug-only key survived a re-scope and forced exactly that, field report
 * 0.12.0). The parse is `PendingSchema`'s strict object, so every field in
 * the file survives into the hashed JSON and none is invented: two ticks
 * reading identical file content always agree on the key, and a whitespace
 * reformat — which re-scopes nothing — never lifts a hold.
 *
 * **`observedFiles` is excluded, declared divergence from spec/loop.md's
 * "a hash of its bytes".** That field is the engine's own accretion, not a
 * declaration anyone re-scoped: `commitPendingUpdate` merges a failed
 * attempt's footprint onto the entry in the *same* wave that blames it, so
 * hashing it would have every merge- and gate-stage quarantine mint a fresh
 * key on the next read and lift its own hold — the run re-attempts the wall
 * at full agent price, which is the burn the section exists to prevent.
 * A key identifying the work as declared cannot be keyed on the engine's
 * notes about it (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*). Every other write-back is a real state change and re-keys
 * deliberately.
 *
 * Like a failure signature, the result is an **opaque equality key**:
 * written by the engine, compared by the engine, never parsed apart by
 * either side of the `FLUME_QUARANTINED_SLUGS` channel.
 */
export function quarantineKey(entry: PendingEntry): string {
  const { observedFiles: _engineAccretion, ...declared } = entry;
  const hash = createHash("sha1")
    .update(JSON.stringify(declared))
    .digest("hex")
    .slice(0, QUARANTINE_KEY_HASH_LENGTH);
  return `${slugify(entry.tag)}@${hash}`;
}

/**
 * The entry-scoping half of every stage-failure record, filled from the
 * entry the failure is blamed on. One home for the `tag`/`quarantineKey`
 * pairing {@link StageFailureEntry} types — a call site that has the entry
 * spreads this rather than rebuilding either half.
 */
export function blamedOn(entry: PendingEntry): {
  tag: string;
  quarantineKey: string;
} {
  return { tag: entry.tag, quarantineKey: quarantineKey(entry) };
}

/**
 * Pickability in the fanout context. The dispatcher's model: a dep is
 * satisfied iff it is no longer in pending (we remove entries on ship).
 * `requiresCapability` is pickable iff the chain's declared `capabilities`
 * asserts the entry's named capability.
 *
 * The foundations governor runs first: an entry whose `dependsOnForks`
 * contains any unresolved slug is not pickable, regardless of gate kind.
 * `isForkResolved` defaults to always-resolved so the check is a no-op when no
 * resolver is wired or no entry declares a fork dependency.
 */
function isPickable(
  entry: PendingEntry,
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean = () => true,
  capabilities: ReadonlySet<string> = new Set(),
): boolean {
  if (!entry.dependsOnForks.every(isForkResolved)) return false;
  switch (entry.gate.kind) {
    case "open":
      return true;
    case "blockedBy": {
      // Narrow into a local so the closure doesn't lose the discriminator.
      const depTags = entry.gate.tags;
      return depTags.every((depTag) => !pending.some((e) => e.tag === depTag));
    }
    case "parked":
    case "deferred":
      return false;
    case "requiresCapability":
      return capabilities.has(entry.gate.capability);
  }
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

/** Whether this run's live quarantine holds the entry **as read** ({@link quarantineKey}). */
function heldByQuarantine(
  entry: PendingEntry,
  quarantinedSlugs?: ReadonlySet<string>,
): boolean {
  return quarantinedSlugs?.has(quarantineKey(entry)) ?? false;
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
    });
  };
}

/**
 * The pickable set and the two holds that shrank it — what `isPickable`
 * cleared, minus this run's live quarantine, minus what the chain's own
 * refusal declined, with each hold named by the entries it took.
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
   * Entries the chain's own `refusesEntry` (`src/Phase.ts`) declined, by tag.
   * An entry the quarantine already took is never offered to the predicate
   * and so is named above alone: the engine's own hold is answered first, and
   * a chain is asked about entries it could otherwise have.
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
  refuses: (entry: PendingEntry) => boolean;
}): PickableSelection {
  const eligible = gateEligible(
    opts.pending,
    opts.isForkResolved,
    opts.capabilities,
  );
  // One consult per entry offered, partitioned in the same pass: the
  // predicate is the chain's code, and asking it twice about one entry both
  // pays for it twice and lets two answers disagree inside one selection.
  const pickable: PendingEntry[] = [];
  const refused: PendingEntry[] = [];
  for (const e of eligible) {
    if (heldByQuarantine(e, opts.quarantinedSlugs)) continue;
    (opts.refuses(e) ? refused : pickable).push(e);
  }
  return {
    pickable,
    quarantinedTags: eligible
      .filter((e) => heldByQuarantine(e, opts.quarantinedSlugs))
      .map((e) => ({ tag: e.tag, key: quarantineKey(e) })),
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
  // provisioning failed on a prior tick) is dropped here — `pending.json`
  // itself is untouched, so a fresh run/process retries it from scratch.
  // The chain's own per-entry refusal is answered after it, over the entries
  // the quarantine left standing.
  const selected = pickableSelection({
    pending,
    isForkResolved,
    capabilities,
    ...(opts.quarantinedSlugs !== undefined
      ? { quarantinedSlugs: opts.quarantinedSlugs }
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
