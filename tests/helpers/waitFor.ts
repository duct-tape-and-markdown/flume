/**
 * Either lane's one sync point between spawning a process and asserting on
 * something that process does.
 *
 * The integration lane is where it was written; the default-lane suites that
 * spawn a CLI and then read what it wrote call it too, and the ceiling below
 * is sized for both. A helper scoped in its own header to the lane it was
 * born in reads, to every caller outside that lane, as a ceiling somebody
 * measured somewhere else.
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

import { parsePidClaim, type PidClaim } from "../../src/pidClaim.ts";

/**
 * How long a wait may run before it refuses. Sized as a ceiling over the
 * slowest thing either lane waits on — a `node`+`tsx` startup reaching its
 * first disk write — with room for a host slower than the one that measured
 * it, and inside `SPAWN_BUDGET_MS` (`tests/helpers/subprocess.ts`), the
 * per-case budget every spawning file declares, so a blown wait reds with its
 * own message rather than the runner's timeout.
 *
 * No figure of that budget is restated here. It has one home, this ceiling is
 * sized against it, and `tests/subprocessHelper.test.ts` holds the relation,
 * so a budget moved under this ceiling reds there rather than leaving a
 * warrant that still reads true (`.claude/rules/engineering.md`, "Derived
 * state is computed, never restated beside its source").
 */
export const WAIT_TIMEOUT_MS = 10_000;

/** Gap between probes. Short enough that "as soon as" means it. */
export const WAIT_INTERVAL_MS = 25;

/**
 * A wait that reached its ceiling, thrown by {@link waitFor} and by nothing
 * else.
 *
 * The refusal is the assertion its call site dropped, so it has to reach that
 * call site. Awaited directly by a case it does; inside an agent body it does
 * not, because the engine absorbs whatever an invocation throws and the tick
 * falls through as an entry that did not commit (`invokeAgent`,
 * `src/tickAttempt.ts`). That absorption is the engine's own contract, not a
 * test's to change — so the refusal reaching past a body rests on being
 * recognizable rather than on the caller rethrowing it, and this class is how
 * the fake agents' body wrapper tells it from a body's own deliberate throw
 * and records it where the case reads it (`runAgentBody`,
 * `tests/helpers/dispatcherFixture.ts`).
 */
export class BlownWait extends Error {}

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
      throw new BlownWait(
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

/**
 * The same probe, decoded: the holder a guard file names, once the file holds
 * a claim the engine's own reader accepts. `undefined` until then — absent,
 * empty, or a write caught mid-flight with no usable pid yet.
 *
 * The decode is `parsePidClaim`'s (`src/pidClaim.ts`), never a split spelled
 * here: a guard file states the holder's pid on the first line and the claim
 * instant on the second, and a call site reading it with `Number()` over the
 * whole file gets `NaN` and signals nothing
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote" — the real writer is the CLI under test, the real reader is this).
 */
export function pidClaimIn(path: string): PidClaim | undefined {
  const text = fileWithContent(path);
  if (text === undefined) return undefined;
  return parsePidClaim(text) ?? undefined;
}
