/**
 * The one list of *this* repo's chain vocabulary that shipped engine surface
 * may not name — a phase name, a plan-lane artifact, our own state directory.
 * Vocabulary from one implementation's chain, on a surface every consumer
 * reads, ships that implementation's conventions with the engine's authority
 * (`.claude/rules/engine-boundary.md`, *Capability vs convention*).
 *
 * Two judges assert this absence: the doc comments on chain-facing options,
 * which ship as hover text (tests/docComments.test.ts), and the pending schema
 * rendered into every downstream chain's plan prompt
 * (tests/PendingSchema.test.ts). Detection one performs is shared, never
 * re-derived beside the other (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*) — the two local copies this replaced had already diverged,
 * and a term added here now reaches every subject at once.
 *
 * Each entry names the **class**, not one literal: pinning a single phrase
 * lets its siblings ship green.
 *
 * Scoped to shipped *surface*. This does not lift to every doc comment in
 * `src/` — `.flume/` is the engine's own default path in Gate.ts and
 * Phase.ts, where naming it is the mechanism, not a convention. Vocabulary
 * specific to one subject stays with that subject.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { expect } from "vitest";

/**
 * Module-local: `expectNoChainVocabulary` is the whole consumer surface, and an
 * export nothing imports is residue (`.claude/rules/engineering.md`, *An export
 * earns its consumer*). A third judge that needs the raw patterns widens it
 * then.
 */
const CHAIN_VOCABULARY: readonly RegExp[] = [
  /\b(plan|build|workshop|sweep|inbox|derive)\b/i,
  /open[-\s]questions?/i,
  /\.flume\//,
];

/**
 * Assert `subject` names no term in the list above. `label` says
 * which subject failed, for a judge reading more than one.
 *
 * An absence is green over an empty string, so the non-empty floor rides here;
 * proving the subject is the *right* one stays with the caller, which is the
 * only side that knows what it read (`.claude/rules/engineering.md`, *A green
 * verdict is proven non-vacuous*).
 */
export function expectNoChainVocabulary(subject: string, label: string): void {
  expect(subject, `${label} is empty — nothing to judge`).not.toBe("");
  for (const pattern of CHAIN_VOCABULARY) {
    expect(subject, `${label} matches ${pattern}`).not.toMatch(pattern);
  }
}
