/**
 * The integration lane's one sync point between spawning a process and
 * asserting on something that process does.
 *
 * A fixed sleep guesses how long the spawn takes, and the guess is calibrated
 * on a host running one file: under whole-lane contention the same guess goes
 * short and reds an innocent case (spec/worktrees.md, "The default test lane
 * must stay fast" — a load-sensitive timing assertion belongs in neither lane
 * until it is event-based). The wait below ends on the event itself, so a warm
 * host pays milliseconds and a loaded one pays what it needs.
 *
 * Its deadline is a ceiling, not a cost. Reaching it is a failure, and the
 * failure names what was awaited rather than degrading into a bare
 * `expect(false).toBe(true)` at the assertion downstream
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own;
 * `tests/waitForHelper.test.ts` is its cover, and runs in the default lane.
 */

import { readFileSync } from "node:fs";

/**
 * How long a wait may run before it refuses. Sized as a ceiling over the
 * slowest thing this lane waits on — a `node`+`tsx` startup reaching its first
 * disk write — with room for a host slower than the one that measured it, and
 * well inside the 30s per-case budget the lane's spawning sites declare, so a
 * blown wait reds with its own message rather than the runner's timeout.
 */
export const WAIT_TIMEOUT_MS = 10_000;

/** Gap between probes. Short enough that "as soon as" means it. */
export const WAIT_INTERVAL_MS = 25;

export interface WaitOptions {
  /** Ceiling before the wait refuses. Defaults to {@link WAIT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Gap between probes. Defaults to {@link WAIT_INTERVAL_MS}. */
  intervalMs?: number;
}

/**
 * Probe `until` until it reports the thing arrived, then resolve with what it
 * reported. `undefined` is "not yet"; any other value holds.
 *
 * `what` is the phrase the refusal names, so it reads as the assertion it
 * stands in for: "the loop's tip claim at <path>", not "condition".
 */
export async function waitFor<T>(
  what: string,
  until: () => T | undefined | Promise<T | undefined>,
  opts: WaitOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? WAIT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? WAIT_INTERVAL_MS;
  const started = Date.now();
  for (;;) {
    const held = await until();
    if (held !== undefined) return held;
    const waited = Date.now() - started;
    if (waited >= timeoutMs) {
      throw new Error(
        `flume test harness: waited ${waited}ms for ${what} and it never ` +
          `arrived (ceiling ${timeoutMs}ms)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * The lane's one probe: a pid file (a tip claim, a `loop.pid`) is a sync point
 * only once its content is there. `writeFile` creates before it writes, so
 * "exists" can be observed as an empty file whose pid a caller then compares
 * against — content, not existence, is the event.
 *
 * Only ENOENT reads as "not yet"; any other read failure is the caller's to
 * see.
 */
export function fileWithContent(path: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return text.length > 0 ? text : undefined;
}
