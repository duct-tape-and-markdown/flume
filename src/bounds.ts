/**
 * bounds — the three truncation idioms the harness digests strings with.
 *
 * A leaf module on purpose: two independent consumers need the same three
 * shapes — `src/Dispatcher.ts` for its failure signatures,
 * `src/priorAttempts.ts` for the persisted record fields — and a copy on
 * either side is how the two drift apart. Nothing here reads disk or git,
 * so both can import it without a cycle.
 *
 * Every one of them marks its own elision: a bounded string that reads as a
 * whole one is the false signal the bound must not introduce.
 */

/** Cap a string to `max` chars, marking the elision so truncation is visible. */
export function bound(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

/**
 * Keep the *last* `max` chars (the agent's final message lives at the tail
 * of stdout), marking the elision at the head so truncation is visible.
 */
export function tailBound(s: string, max: number): string {
  if (s.length <= max) return s;
  return `[truncated ${s.length - max} chars]…\n` + s.slice(s.length - max);
}

/**
 * Keep both ends of `s` — `max - tailBudget` chars of head plus `tailBudget`
 * of tail — eliding the middle with a visible marker. The digest shape for a
 * gate's captured output, where the two ends carry different facts and the
 * middle is filler.
 *
 * Measured against this repo's own vitest afterMerge gate (2026-09-06, a
 * 22 KB capture): the reporter emits the `Failed Tests` section — which
 * tests failed, and the assertion text — in the **first** ~1 KB, then ~20 KB
 * of per-test pass lines, then the `Test Files … failed | … passed` counts
 * in the last ~200 bytes. A tail-only slice of that capture is pass lines
 * and a count: it says how many failed and never which. A head-only slice
 * loses the counts the moment a reporter puts its failure section last, as
 * some do. Keeping both ends is the content-agnostic answer — no line is
 * parsed, no reporter's layout is assumed, and neither end can be crowded
 * out by the other's length.
 *
 * Distinct from {@link tailBound} by design, not by oversight: that helper
 * keeps the tail *only*, which is right for an agent's final message, where
 * the refused constraint is the last thing said and everything before it is
 * transcript.
 */
export function headTailBound(
  s: string,
  max: number,
  tailBudget: number,
): string {
  if (s.length <= max) return s;
  const tail = Math.min(tailBudget, max);
  const head = max - tail;
  return (
    s.slice(0, head) +
    `\n…[truncated ${s.length - max} chars]…\n` +
    s.slice(s.length - tail)
  );
}
