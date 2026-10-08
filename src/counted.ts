/**
 * counted — the one refusal a value that counts something a run must have at
 * least one of takes: a zero, a negative, or a fraction is a run that cannot
 * happen, refused where the value arrives rather than at the boundary where
 * the symptom appears (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Two surfaces carry such a value and neither can run on one out of range:
 * the chain's own declarations, refused at the load (`src/chainLoad.ts`), and
 * the options an embedder constructs the runtime with (`src/Dispatcher.ts`).
 * The predicate and the sentence live here so the two halves of one knob
 * refuse the same way rather than one of them not at all
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * A leaf module: nothing here reads disk, git, or a chain, so either side
 * imports it without a cycle.
 */

/**
 * One counted value: the field as its author spells it, the value, why one is
 * the floor, and what omitting it falls back to — the three facts a refusal
 * has to carry for its reader to act without opening the engine.
 */
export interface CountedValue {
  field: string;
  value: number | undefined;
  why: string;
  omitted: string;
}

/**
 * Why a fanout wave's width cannot be below one. Stated once because both
 * halves of that width refuse on it — the chain's
 * `supervisorPolicy.maxParallel` and the embedder's
 * `DispatcherOptions.maxParallel` — and a second copy is the one that goes
 * stale (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
export const WAVE_WIDTH_FLOOR_REASON =
  `it is how many entry worktrees one fanout wave holds open at once, and a ` +
  `wave that may open no slot picks nothing from a queue that was ready`;

/**
 * Refuse `counted` unless it is a positive integer, naming `source` — how the
 * refusal spells where the value came from, "chain declares" for a chain's own
 * fields — so one sentence reads correctly for a declaration and for a
 * construction argument.
 *
 * Undeclared is a strict no-op: the fallback is the caller's to apply.
 */
export function assertPositiveCount(
  source: string,
  counted: CountedValue,
): void {
  const { field, value, why, omitted } = counted;
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${source} ${field}: ${JSON.stringify(value)}; ` +
        `it must be a positive integer — ${why}. Omit it for the default ` +
        `of ${omitted}.`,
    );
  }
}
