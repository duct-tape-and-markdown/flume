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

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../src/log.ts";
import { operatorLog, stampLines, stampedLogger } from "../src/cliLog.ts";
import { STAMPED_LINE, stampedContent } from "./helpers/stampedLine.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

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
        // The level is the sink's, unchanged: the stamp prefixes a line and
        // decides nothing about which method carries it, which is what lets
        // the stream choice sit in the sink below.
        expect(line.startsWith(`${level} `)).toBe(true);
        const stamped = line.slice(level.length + 1);
        expect(stamped).toMatch(STAMPED_LINE);
        const at = Date.parse(STAMPED_LINE.exec(stamped)![1]!);
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
      // rewrite. Read back through the suite's one reader of a stamped line
      // (`tests/helpers/stampedLine.ts`) rather than a width spelled here.
      expect(lines.map(stampedContent)).toEqual([
        "first line",
        "second line",
        "third line",
      ]);
    });
  },
);

/**
 * The stream half of the same decision, at the same unit: `spec/cli.md`, *A
 * log line carries the instant it was written* sends stamped narration to
 * stderr at every level, so a verb's stdout carries only what the verb
 * produced. The engine's own default keeps its split — `info` to stdout —
 * and is pinned for that in `tests/log.test.ts`; the two verbs' whole streams
 * are read end-to-end in `tests/cli.test.ts`.
 *
 * Driven through `operatorLog` (`src/cliLog.ts`) — this process's one
 * construction, the value every verb narrates through — against the real
 * console it writes to, because what a console method received is the only
 * place the stream is decided (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*).
 */
describe("operatorLog (spec/cli.md §A log line carries the instant it was written)", () => {
  it("the CLI's stamped narration writes an info line to stderr", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    operatorLog.info("an informational line");

    // Vacuity, and the claim: the line was written at all, it went to
    // stderr, and it is the line that was handed in — read back through the
    // suite's one reader of a stamped line, so the stamp rode along.
    expect(error.mock.calls).toHaveLength(1);
    expect(stampedContent(error.mock.calls[0]![0] as string)).toBe(
      "an informational line",
    );
    expect(log.mock.calls, "an info line reached stdout").toEqual([]);

    // `warn` and `error` land where they already did: the same stream, each
    // still stamped, so moving `info` moved nothing else.
    operatorLog.warn("a warning line");
    operatorLog.error("an error line");
    expect(
      error.mock.calls.map((call) => stampedContent(call[0] as string)),
    ).toEqual(["an informational line", "a warning line", "an error line"]);
    expect(log.mock.calls, "a narration line reached stdout").toEqual([]);
    expect(warn.mock.calls, "a narration line reached console.warn").toEqual(
      [],
    );
  });
});
