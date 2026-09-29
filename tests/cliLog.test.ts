/**
 * The CLI's stamp, at the unit the verbs narrate through.
 *
 * `spec/cli.md`, *A log line carries the instant it was written* puts the
 * stamp on the consumer's side of the logging seam: `stampedLogger`
 * (`src/cliLog.ts`) is what `flume loop` and `flume tick` hand to the engine
 * in place of its own default. What that default does instead — relay, and
 * nothing more — is the other half of the same decision, pinned at its own
 * unit in `tests/log.test.ts`; the two verbs' whole streams are read
 * end-to-end in `tests/cli.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { Logger } from "../src/log.ts";
import { stampLines, stampedLogger } from "../src/cliLog.ts";

/**
 * ISO-8601 UTC to the millisecond — the spelling the tick verdict, the claim
 * file and record filenames already carry, and the one a line has to open
 * with for a log to line up against them.
 */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /;

/** A `Logger` that keeps what it was handed, per level. */
function recordingLogger(): { sink: Logger; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    sink: {
      info: (line) => lines.push(`info ${line}`),
      warn: (line) => lines.push(`warn ${line}`),
      error: (line) => lines.push(`error ${line}`),
    },
  };
}

describe(
  "the CLI's stamp is the CLI's (spec/cli.md §A log line carries the instant it was written)",
  () => {
    it("stampedLogger opens every level's line with the instant it was written", () => {
      const { sink, lines } = recordingLogger();
      const before = Date.now();
      const log = stampedLogger(sink);
      log.info("an informational line");
      log.warn("a warning line");
      log.error("an error line");
      const after = Date.now();

      expect(lines).toHaveLength(3);
      for (const [index, level] of ["info", "warn", "error"].entries()) {
        const line = lines[index]!;
        // The level is the sink's, unchanged: a stamp that rerouted a warning
        // to stdout would move it off the stream an operator greps.
        expect(line.startsWith(`${level} `)).toBe(true);
        const stamped = line.slice(level.length + 1);
        expect(stamped).toMatch(STAMP);
        const at = Date.parse(stamped.slice(0, stamped.indexOf(" ")));
        expect(at).toBeGreaterThanOrEqual(before);
        expect(at).toBeLessThanOrEqual(after);
      }
    });

    it("stampLines opens each line of a multi-line message, not only the first", () => {
      const at = new Date("2026-09-28T12:34:56.789Z");
      const stamped = stampLines(at, "first line\nsecond line\nthird line");
      const lines = stamped.split("\n");

      // Vacuity: the message really did span three lines.
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(line.startsWith("2026-09-28T12:34:56.789Z ")).toBe(true);
      }
      // The message itself crosses intact — the stamp is a prefix, not a
      // rewrite.
      expect(lines.map((l) => l.slice("2026-09-28T12:34:56.789Z ".length))).toEqual([
        "first line",
        "second line",
        "third line",
      ]);
    });
  },
);
