/**
 * entryKey — one queue entry's identity **as declared**: its tag slug and a
 * hash of the declaration `pending.json` carries for it, joined `slug@hash`.
 *
 * Its own module because two mechanics key on that identity and neither owns
 * it — the run-scoped quarantine hold (`src/selection.ts`) and the
 * prior-attempt record's generation stamp (`PriorAttempt.declaredAs`,
 * `src/priorAttempts.ts`, which selection reads back through
 * `entryAttemptKey`). Spelled inside either, the other reaches it across a
 * module cycle or respells the derivation
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { createHash } from "node:crypto";

import type { PendingEntry } from "./PendingSchema.js";
import { slugify } from "./paths.js";

/** Hex width of the declaration half of an {@link entryDeclaredKey}. */
const DECLARED_KEY_HASH_LENGTH = 10;

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort": the key
 * for one entry **as read** — its slug and a hash of its bytes in
 * `pending.json`, joined `slug@hash`.
 *
 * The hash covers the entry's whole parsed shape, so any edit to it — a
 * re-scoped `files`, a widened `summary`, a changed gate — yields a new key.
 * That is what lifts a hold the old key still carries with no
 * stop-and-relaunch (a slug-only key survived a re-scope and forced exactly
 * that, field report 0.12.0), and equally what ends a prior-attempt record's
 * standing against the entry the moment a producer rewrites it
 * (`spec/harness.md`, *The phases*). The parse is `PendingSchema`'s strict
 * object, so every field in the file survives into the hashed JSON and none is
 * invented: two ticks reading identical file content always agree on the key,
 * and a whitespace reformat — which re-scopes nothing — never lifts a hold.
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
 * either side of the `FLUME_QUARANTINED_SLUGS` channel, and never composed
 * by a chain — a consumer comparing two of them reads both off the surfaces
 * the engine reports them on (`EntryRefusalContext`, `src/Phase.ts`).
 */
export function entryDeclaredKey(entry: PendingEntry): string {
  const { observedFiles: _engineAccretion, ...declared } = entry;
  const hash = createHash("sha1")
    .update(JSON.stringify(declared))
    .digest("hex")
    .slice(0, DECLARED_KEY_HASH_LENGTH);
  return `${slugify(entry.tag)}@${hash}`;
}
