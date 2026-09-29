/**
 * The stamp an operator line opens with, for every case that reads one back.
 *
 * Its own file because three suites now need the same spelling:
 * `tests/cli.test.ts` asserts a run's lines carry it — every operator line the
 * CLI writes, a verb's own refusals and their indented detail rows included —
 * and reads a report whose two producers disagree about whether one is there;
 * `tests/cliHelp.test.ts` reads a refusal's subject off the line that leads
 * with it; and `tests/cliLog.test.ts` reads back what the writer at the unit
 * emitted. A second copy of the pattern is a copy that drifts from the writer
 * (`.claude/rules/engineering.md`, *A module is one job*).
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
 *
 * The stamp and its one separating space, and nothing about what follows:
 * `stampLines` (`src/cliLog.ts`) prefixes every line it is handed, so a line
 * whose own content is indented — `flume check`'s violation detail rows open
 * with two spaces — is as stamped as any other. Requiring a non-space here
 * would read those rows as unstamped and pass the sweep that exists to catch
 * exactly that (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
export const STAMPED_LINE = new RegExp(String.raw`^(${STAMP_SOURCE}) `);

/**
 * What the writer was handed, with the stamp and its separating space
 * removed — `undefined` when the line carried no stamp. A case that cares
 * what a stamped line *says* reads it out through here rather than slicing a
 * width of its own, so the offset stays the writer's fact and the indent a
 * row carries survives into the caller's predicate.
 */
export function stampedContent(line: string): string | undefined {
  const match = STAMPED_LINE.exec(line);
  return match ? line.slice(match[1]!.length + 1) : undefined;
}

/**
 * A leading stamp, optional — the prefix a pattern anchored at the start of a
 * line skips when the two writers it is pointed at disagree about carrying
 * one. That is a reader over a *pair* of producers, one of which narrates to
 * an operator and one of which does not: the CLI stamps every line it writes
 * (`spec/cli.md`, *A log line carries the instant it was written*), while a
 * gate's `details` string is handed back to a caller and carries none. A
 * reader of CLI output alone requires the stamp instead, since there the
 * absence is the defect.
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
