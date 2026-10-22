/**
 * counted — the one refusal a value that counts something a run must have at
 * least one of takes: a zero, a negative, or a fraction is a run that cannot
 * happen, refused where the value arrives rather than at the boundary where
 * the symptom appears (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Three surfaces carry such a value and none can run on one out of range: the
 * chain's own declarations, refused at the load (`src/chainLoad.ts`); the
 * options an embedder constructs the runtime with (`src/Dispatcher.ts`); and
 * the arguments of a helper the package hands out, refused at the call
 * (`src/partition.ts`). The predicate and the sentence live here so every
 * surface carrying one knob refuses the same way rather than one of them not
 * at all (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * What an *absent* value means is the surface's, not the value's, so the
 * predicate has two arms rather than one: the first two surfaces admit an
 * omission and fall through to a default they name
 * ({@link assertPositiveCount}), while a required argument has no default
 * below it and an absent one is the knob gone entirely
 * ({@link assertRequiredPositiveCount}). One arm for both would have to pick
 * which surface is wrong — a no-op for a required argument proceeds over an
 * unresolved input, and a refusal for an optional field refuses the omission
 * the declaration is allowed to make.
 *
 * A leaf module: nothing here reads disk, git, or a chain, so either side
 * imports it without a cycle.
 */

/**
 * One counted value: the field as its author spells it, the value, why one is
 * the floor, and — where the surface admits an omission — what omitting it
 * falls back to. The facts a refusal has to carry for its reader to act
 * without opening the engine.
 */
export interface CountedValue {
  field: string;
  value: number | undefined;
  why: string;
  /**
   * What omitting the field binds instead, stated only where omitting it is a
   * shape the surface admits: a declaration the chain may leave out, an option
   * an embedder may skip. A required argument carries none by type rather than
   * by discipline — {@link assertRequiredPositiveCount} takes the value
   * without this field — so its refusal stops at `why` rather than offering an
   * omission the signature refuses.
   */
  omitted?: string;
}

/**
 * Why a fanout wave's width cannot be below one. Stated once because every
 * surface carrying that width refuses on it — the chain's
 * `supervisorPolicy.maxParallel`, the embedder's
 * `DispatcherOptions.maxParallel`, and the `maxParallel` a caller of
 * `partitionByFileOverlap` (`src/partition.ts`) passes — and a second copy is
 * the one that goes stale (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
export const WAVE_WIDTH_FLOOR_REASON =
  `it is how many entry worktrees one fanout wave holds open at once, and a ` +
  `wave that may open no slot picks nothing from a queue that was ready`;

/**
 * Refuse `counted` unless it is a positive integer, naming `source` — how the
 * refusal spells where the value came from, "chain declares" for a chain's own
 * fields — so one sentence reads correctly for a declaration, a construction
 * argument, and a call's required argument alike.
 *
 * Undeclared is a strict no-op: the surface admits the omission, so the
 * fallback the refusal would have named is the caller's to apply. A required
 * argument takes {@link assertRequiredPositiveCount} instead, which has no
 * such arm.
 */
export function assertPositiveCount(
  source: string,
  counted: CountedValue,
): void {
  if (counted.value === undefined) return;
  refusePositiveCount(source, counted);
}

/**
 * The same refusal over a value the surface requires: `undefined` is refused
 * beside a zero and a fraction rather than passed through, because there is no
 * omission arm under a required argument — nothing downstream applies a
 * default, and the knob is simply gone
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Reachable rather than typed away: a consumer's `chain.ts` is transpiled by
 * `tsx` and never typechecked, so a hook that composes the argument reaches a
 * required `number` with `undefined` and the compiler never sees it. The value
 * carries no `omitted` — the signature drops the field, so the refusal cannot
 * offer a fallback that does not exist.
 */
export function assertRequiredPositiveCount(
  source: string,
  counted: Omit<CountedValue, "omitted">,
): void {
  refusePositiveCount(source, counted);
}

/**
 * The one sentence both arms refuse with, over a value they have each already
 * decided an absent one means for their surface. Out of range here includes
 * `undefined`: the arms differ on whether an absent value reaches this point,
 * never on what it reads as once it has.
 */
function refusePositiveCount(source: string, counted: CountedValue): void {
  const { field, value, why, omitted } = counted;
  if (value !== undefined && Number.isInteger(value) && value >= 1) return;
  const fallback =
    omitted === undefined ? "" : ` Omit it for the default of ${omitted}.`;
  // `JSON.stringify` renders no value at all for `undefined`, so the absent
  // case spells itself rather than interpolating as a bare gap.
  const shown = value === undefined ? "undefined" : JSON.stringify(value);
  throw new Error(
    `${source} ${field}: ${shown}; ` +
      `it must be a positive integer — ${why}.${fallback}`,
  );
}
