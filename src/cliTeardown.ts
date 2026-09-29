/**
 * The signalled teardown a long-running verb installs: what a Ctrl-C or a
 * SIGTERM does to the work already in flight before this process exits.
 *
 * One home because `flume tick` and `flume loop` spell the same sequence one
 * rung apart (`.claude/rules/engineering.md`, *A module is one job*): abort
 * the run's own signal, announce the wait, await the in-flight work rather
 * than exiting over a live writer, release what is held, exit on the signal's
 * code. What differs is only the thing waited on, the grace it ends under and
 * what is released — each supplied by the caller, each read at receipt rather
 * than at install, because none of the three is known when the handlers go on.
 *
 * Release rides these handlers and an `exit` handler both: a `finally` alone
 * runs on neither signal, so a signalled run left its claims standing until a
 * liveness probe happened to catch the pid dead (spec/loop.md, *The loop lock
 * and the tip claim*). Nothing gates the drop — a stake releases at most once,
 * at the file it created (`StakedPidClaim`, `src/pidClaim.ts`) — so the
 * handler and the caller's own `finally` may both run without the second
 * deleting a claim a later process has since taken.
 */

import type { Logger } from "./log.js";

/**
 * What a signal handler says at receipt, before the wait it is announcing
 * starts (spec/loop.md, "The loop lock and the tip claim"). One spelling for
 * both callers: a `flume loop` waiting on its tick child and a bare `flume
 * tick` waiting on its agent tree are the same promise one rung apart, and
 * the operator at a Ctrl-C is at whichever one they launched.
 *
 * Neither wait is bounded by the handler, so the only number that ends a tree
 * ignoring the SIGTERM is the escalation grace — named here rather than left
 * to a lookup, because `--help` names no supervisor knob and a Ctrl-C that
 * takes the whole grace is otherwise a silent hang.
 */
function signalledWaitLine(waitingOn: string, graceMs: number): string {
  return (
    `[flume] signalled; waiting for ${waitingOn} to exit — this wait has no ` +
    `bound of its own; the SIGKILL that ends a tree ignoring the SIGTERM ` +
    `lands ${graceMs}ms after it (supervisorPolicy.killGraceMs)`
  );
}

/** What a caller hands {@link installSignalledTeardown}. */
interface SignalledTeardown {
  /** The run's own stop signal, aborted first so the tree starts winding down. */
  readonly abort: AbortController;
  /** What the announcement calls the thing being waited on. */
  readonly waitingOn: string;
  /**
   * The in-flight work, read at receipt: `undefined` before it starts and
   * after it returns, where there is no tree to take along and a line about a
   * wait that never happens would be noise.
   */
  readonly inFlight: () => Promise<unknown> | undefined;
  /**
   * The escalation grace the announcement names, read at receipt: the
   * declaration it comes off is resolved later than this install, and a
   * resolve that failed still names the engine default the teardown applies.
   */
  readonly killGraceMs: () => number;
  /** What this process releases — idempotent, so `exit` may run it again. */
  readonly release: () => void;
  readonly log: Logger;
}

/**
 * Install the `exit`, `SIGINT` and `SIGTERM` handlers, before the first thing
 * {@link SignalledTeardown.release} would drop is taken. A signal landing
 * during an acquisition must find a handler, not node's default disposition —
 * which runs nothing and leaves whatever is already on disk.
 */
export function installSignalledTeardown(teardown: SignalledTeardown): void {
  const releaseAndExit = async (code: number): Promise<never> => {
    teardown.abort.abort();
    const inFlight = teardown.inFlight();
    if (inFlight !== undefined) {
      // The wait, announced before it starts rather than explained after it
      // ends.
      teardown.log.info(
        signalledWaitLine(teardown.waitingOn, teardown.killGraceMs()),
      );
      // The work's own failure is the work's to report; this path owes the
      // operator a dead tree, a released claim, and the signal's exit code,
      // and a throw escaping here would replace all three with an unhandled
      // rejection.
      await inFlight.catch(() => undefined);
    }
    teardown.release();
    process.exit(code);
  };
  process.on("exit", teardown.release);
  process.on("SIGINT", () => void releaseAndExit(130));
  process.on("SIGTERM", () => void releaseAndExit(143));
}
