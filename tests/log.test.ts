/**
 * The engine's logging default, pinned for what it adds: nothing.
 *
 * `consoleLogger` (`src/log.ts`) is the far side of the decision
 * `spec/cli.md`, *A log line carries the instant it was written* records.
 * The CLI stamps its own operator lines and hands the stamped `Logger` down
 * (`src/cliLog.ts`, `tests/cliLog.test.ts`); the engine fallback stays a
 * plain relay, so an embedder routing a `Logger` of its own times its lines
 * its own way (`.claude/rules/engine-boundary.md`, *Surface, not
 * prescription*). A stamp that drifted down to this side would arrive in
 * every consumer with the engine's authority behind it, which is exactly the
 * default that section refuses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../src/log.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consoleLogger (.claude/rules/engine-boundary.md §Surface, not prescription)", () => {
  it("consoleLogger writes the line it was handed unstamped", () => {
    // The real writer driven through the real console it writes to: what
    // reaches `console.log` is what an embedder sees when it declines to
    // route a `Logger` of its own.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleLogger.info("an informational line");
    consoleLogger.warn("a warning line");
    consoleLogger.error("an error line");

    // Vacuity: all three levels reached a console at all, each its own.
    expect(log.mock.calls).toHaveLength(1);
    expect(warn.mock.calls).toHaveLength(1);
    expect(error.mock.calls).toHaveLength(1);

    // Byte-identical, so no stamp, prefix, or level tag rode along.
    expect(log).toHaveBeenCalledWith("an informational line");
    expect(warn).toHaveBeenCalledWith("a warning line");
    expect(error).toHaveBeenCalledWith("an error line");
  });
});
