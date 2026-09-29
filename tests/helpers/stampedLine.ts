/**
 * The stamp an operator line opens with, for every case that reads one back.
 *
 * Its own file because two suites now need the same spelling: `tests/cli.test.ts`
 * asserts a run's lines carry it, and `tests/cliHelp.test.ts` reads a refusal's
 * subject off a line that may carry it — the refusals bay discovery and the
 * state-root seam take are stamped whichever verb reaches them, while a verb's
 * own listing is not. A second copy of the pattern is a copy that drifts from
 * the writer (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { expect } from "vitest";

/**
 * What `stampLines` (`src/cliLog.ts`) writes: ISO-8601 UTC to the millisecond,
 * the spelling the tick verdict, the claim file and record filenames already
 * carry. Held as a source fragment so a reader can compose it into its own
 * pattern rather than re-spell it.
 */
export const STAMP_SOURCE = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`;

/**
 * A line that opened with its instant, the instant captured — so a case can
 * read it back out and place it against its own wall clock.
 */
export const STAMPED_LINE = new RegExp(String.raw`^(${STAMP_SOURCE}) \S`);

/**
 * A leading stamp, optional — the prefix a pattern anchored at the start of an
 * operator line skips when the line's writer decides whether it carries one.
 */
export const OPTIONAL_STAMP = String.raw`(?:${STAMP_SOURCE} )?`;

/** Every line of a run's output that carried anything, in order. */
export function narratedLines(out: string): string[] {
  return out.split("\n").filter((line) => line.trim() !== "");
}

/**
 * Assert each line opens with a stamp, and that the instant it names falls
 * inside the run's own wall clock — a constant baked into the renderer, or a
 * stamp fixed once at logger construction, passes the shape check and fails
 * here. The bound is widened by a second on each side: the stamp and
 * `Date.now()` are the same host clock, but the child's first line can be
 * written before this process observes the spawn returning.
 */
export function expectStampedDuring(
  lines: string[],
  before: number,
  after: number,
): void {
  for (const line of lines) {
    const match = STAMPED_LINE.exec(line);
    expect(match, `line reached the operator unstamped: ${line}`).not.toBeNull();
    const at = Date.parse(match![1]!);
    expect(at, `stamp outside the run: ${line}`).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(at, `stamp outside the run: ${line}`).toBeLessThanOrEqual(
      after + 1000,
    );
  }
}
