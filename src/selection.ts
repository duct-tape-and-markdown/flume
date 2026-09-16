/**
 * Selection — which entries of a queue a tick may pick, and the batch a
 * fanout wave carries off it.
 *
 * One derivation for every surface that asks: `runSingleton`'s pre-tick read
 * (`src/singletonTick.ts`), `runFanout`'s wave (`src/waveTick.ts`),
 * `render`'s preview and `TickResult.pickableAfter`'s post-tick
 * re-derivation (`src/Dispatcher.ts`). The gate switch, the
 * run-scoped quarantine hold, and the file-overlap partition are spelled here
 * alone, so no two of those surfaces can disagree about what "pickable" means
 * at the moment each is taken (`.claude/rules/engineering.md`, *A module is
 * one job*).
 */

import { createHash } from "node:crypto";

import { partitionByFileOverlap } from "./partition.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Chain } from "./Phase.js";
import { slugify } from "./paths.js";

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
 * `isPickable` plus the run's live quarantine drop — the same filter
 * `runSingleton`'s pre-tick selection, {@link selectBatch} and
 * `TickResult.pickableAfter`'s post-tick re-derivation apply, so no two can
 * disagree on what "pickable" means at the moment each is taken.
 */
export function pickableEntries(
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean,
  capabilities: ReadonlySet<string>,
  quarantinedSlugs?: ReadonlySet<string>,
): PendingEntry[] {
  return gateEligible(pending, isForkResolved, capabilities).filter(
    (e) => !heldByQuarantine(e, quarantinedSlugs),
  );
}

/**
 * What {@link selectBatch} answered: the pickable set the gate switch and the
 * run's quarantine leave standing, the batch arithmetic over it, and the two
 * facts a caller would otherwise re-read off the chain. Named because the
 * wave that runs the selection and the leg context that carries it
 * (`src/tickLeg.ts`) both hold one in a variable.
 */
export interface BatchSelection {
  pickable: PendingEntry[];
  /**
   * Entries the gate switch would pick, but this run's live quarantine
   * drops anyway — key beside tag, so a chain's handoff can tell
   * "quarantined open" from "genuinely pickable" without re-deriving it,
   * and can see which read of the entry the hold stands under. Keyed on
   * the entry as read: an entry re-scoped on trunk hashes to a new key, so
   * the next tick picks it up without a relaunch.
   */
  quarantinedTags: { tag: string; key: string }[];
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
  const quarantinedSlugs = opts.quarantinedSlugs;
  const eligible = gateEligible(pending, isForkResolved, capabilities);
  const pickable = eligible.filter(
    (e) => !heldByQuarantine(e, quarantinedSlugs),
  );
  // spec/pending.md "Fanout partition — disjoint touched paths":
  // `partitionIgnore` narrows the collision set only — `declaredPaths`
  // (fence, write guard, ship detection) is untouched. Both knobs are
  // chain-overridable defaults (.claude/rules/engine-boundary.md's
  // policy-constant rule); `chain` is this tick's freshly-resolved chain,
  // so reading its declaration at the point of use is byte-identical to a
  // per-run bind.
  const partitionIgnore = chain.supervisorPolicy?.partitionIgnore ?? [];
  return {
    pickable,
    quarantinedTags: eligible
      .filter((e) => heldByQuarantine(e, quarantinedSlugs))
      .map((e) => ({ tag: e.tag, key: quarantineKey(e) })),
    batches: partitionByFileOverlap(pickable, {
      maxParallel: chain.supervisorPolicy?.maxParallel ?? opts.maxParallel,
      ignore: partitionIgnore,
    }),
    partitionIgnore,
  };
}
