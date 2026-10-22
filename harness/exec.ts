/**
 * Reading a child process's output from inside a synchronous call: the spawn
 * itself, the bound on what comes back, the bound on how long it may take to
 * come back, and the status and text a failed one carries.
 *
 * **Synchronous because a window's builder is.** The engine calls
 * `promptArgs` synchronously, and every tree and forge read the plan slices
 * make happens under one — the commits past a cursor (`gitRange.ts`), the
 * branch a repository's tip sits on and a lane's run on the forge
 * (`ci.ts`). The engine's own spawn wrapper is `async`
 * (`src/spawnShim.ts`), so the callers that can await take it there; this
 * module is so the ones that cannot each stop carrying their own copy of the
 * same decisions (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * **Nothing here is caught.** A spawn that failed leaves as the error the
 * platform threw — its exit status, its errno, its stderr — for the caller
 * that knows what those mean: `branchAt` (`harness/ci.ts`) tells a detached
 * HEAD from a broken git by git's own exit status, and the lane reader tells
 * a forge CLI that is absent from one that refused by its errno
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). Wrapping the
 * failure would be this module deciding a meaning it was never given. The two
 * errors built here are the refusals, neither of which is a reading of a
 * child's failure: one is a spawn this module declined to make
 * (`shimRetryRefusal`, `src/spawnShim.ts`), the other a child it stopped
 * ({@link deadlineRefusal}). Each carries the platform's error as its
 * `cause`, so the caller that knows what an errno means still reaches one.
 */

import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

import {
  isWin32ShimSpawnFailure,
  shimRetryRefusal,
  wordShimRetryWouldRewrite,
} from "../src/spawnShim.js";
import { thrownMessage } from "../src/thrown.js";

/**
 * How much of one child's stdout is readable: a window-sized diff, a failing
 * job's whole log, a suite's JSON report. One number rather than one per
 * caller, because the bound is the same judgement each time — the point past
 * which the package is holding a runaway rather than material — and nothing
 * about the particular tool that printed it.
 */
export const MAX_OUTPUT_BYTES = 64 << 20;

/**
 * How long one child may run before this door kills it and the call refuses.
 *
 * **A ceiling, not a budget.** Every caller here blocks the thread it runs
 * on — a forge read and a branch read at chain load, a window diff inside a
 * synchronous `promptArgs` — so a child that never exits holds the whole tick
 * open with nothing in any log, and no timer can fire to say so. The number
 * is therefore the one no healthy run of any of them reaches: the slowest is
 * a forge CLI call over the network, seconds on this repository's own runs,
 * with room for a host and a link several times slower.
 *
 * Declared by this package rather than taken from a chain: the door is
 * reached at chain load and from inside a synchronous builder, where no
 * resolved policy is in hand, and this package already declares the ceiling
 * its gates' children run under (`PACKAGE_GATE_TIMEOUT_MS`,
 * `harness/chain.ts`). A caller whose child is quicker than all of them
 * states its own bound below.
 */
export const MAX_CHILD_MS = 5 * 60_000;

/**
 * What the deadline reached signals a child with. SIGTERM rather than a
 * SIGKILL, because the children here are a git read, a forge read and a
 * shell probe, each of which exits on it — and because `execFileSync` offers
 * one signal and no escalation, so the engine's two-stage terminate
 * (`terminateProcessTree`, `src/processTree.ts`) is not available from a
 * synchronous call. Declared rather than inherited from node's default: the
 * refusal below names it, and a reader of that line reads what was actually
 * sent.
 *
 * The bound this door holds is therefore a child that *takes* a signal. A
 * child that ignores SIGTERM — none of this package's own — blocks the
 * synchronous call for as long as it likes, and closing that would take the
 * grace timer no blocked thread can run.
 */
const KILL_SIGNAL = "SIGTERM";

/** What one invocation's caller states; every other option is this module's. */
interface SyncSpawn {
  /** The tree the child runs in. */
  readonly cwd: string;
  /** The child's environment, for a caller that has one to state. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * How long this child may run, for a caller whose own answer is tighter
   * than {@link MAX_CHILD_MS}; the ceiling stands where none is stated.
   */
  readonly timeoutMs?: number;
}

/**
 * `true` iff `err` is this door's deadline reached rather than anything the
 * child said.
 *
 * Node reports the kill it made on the timeout as `ETIMEDOUT` where an
 * errno sits, with the status a child would have exited with left null; a
 * child that merely exited non-zero carries that status and no `code` at
 * all. Keyed on the errno rather than on the signal, because a `maxBuffer`
 * overrun is also a SIGTERM this module never asked for
 * (`.claude/rules/platform-facts.md`, *Node caps a captured child stream at
 * 1 MiB, and reports the overrun as a spawn failure*) and is a different
 * failure with a different fix.
 */
function outranBound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ETIMEDOUT";
}

/**
 * The refusal a reached deadline raises, naming the deadline and the command
 * it bounded.
 *
 * The command is the line this module spawned, because a tick runs many of
 * these and "a child timed out" names none of them; the deadline is the
 * number that was actually held, so a caller-stated bound and the ceiling
 * read apart. Raised rather than returned: the alternative is a caller
 * remembering to inspect a killed child's truncated stdout, which is the
 * confident wrong answer this refusal exists to refuse
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function deadlineRefusal(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  cause: unknown,
): Error {
  return new Error(
    `\`${[command, ...args].join(" ")}\` was still running ${timeoutMs}ms ` +
      `after this package started it, which is the deadline every child of ` +
      `a synchronous capture is held to. It was signalled ${KILL_SIGNAL}, ` +
      `and this call fails on the deadline rather than blocking the tick on ` +
      `a child that may never exit.`,
    { cause },
  );
}

/**
 * One child's stdout, or a throw carrying that child's own failure.
 *
 * stdin is closed and both output streams are piped: a child that would
 * otherwise wait on input fails instead of hanging the tick, and a failure's
 * stderr reaches {@link detailOf} rather than the operator's terminal.
 *
 * And it is bounded: every child started here runs under `spawn.timeoutMs`
 * or {@link MAX_CHILD_MS}, and one that outruns it is signalled and the call
 * throws {@link deadlineRefusal} instead of returning what a killed child had
 * written so far. Closing stdin bounds a child waiting on a writer that
 * cannot arrive; this bounds every other way one fails to come back.
 *
 * The win32 `.cmd`-shim retry rides every spawn here, under the engine's own
 * detection of it (`src/spawnShim.ts`): the direct spawn first, so arguments
 * keep exact quoting, then one shell retry on the single failure a shell can
 * still turn green — and a refusal instead, naming the word, where that
 * retry's re-parse would rewrite the argv it was handed
 * (`wordShimRetryWouldRewrite`, `src/spawnShim.ts`). The callers here spawn
 * git with a format string and a shell with a whole command line, so the
 * refusal is the difference between a failed spawn and a command nobody
 * wrote. A caller spawning a real executable pays nothing for either — the
 * predicate is false everywhere but a win32 ENOENT — and the alternative is
 * each caller deciding for itself whether its binary is ever shimmed, which
 * is how the same decision came to be spelled two different ways in this
 * package.
 */
export function captureSync(
  command: string,
  args: readonly string[],
  spawn: SyncSpawn,
): string {
  try {
    return captureAttempt(command, args, spawn, "direct");
  } catch (err) {
    if (!isWin32ShimSpawnFailure(err)) throw err;
    const rewritten = wordShimRetryWouldRewrite([command, ...args]);
    if (rewritten !== undefined) throw shimRetryRefusal(command, rewritten, err);
    return captureAttempt(command, args, spawn, "shelled");
  }
}

/** Which of the two spawns above an attempt is: the direct one, or the retry. */
type Attempt = "direct" | "shelled";

/**
 * One attempt at the child — every option this module settles, the spawn, and
 * the deadline read back off whatever it threw.
 *
 * Both legs go through here rather than one: the shell retry runs the same
 * child under the same bound, and a deadline the retry reached would
 * otherwise leave as node's own `ETIMEDOUT`, the one failure shape whose
 * message names neither the deadline nor the command line that outran it.
 *
 * The options are built here beside the call rather than handed in, so what
 * every child of this door is held to — its cap, its deadline, its closed
 * stdin — is spelled at the site that starts it and the two legs cannot
 * differ in anything but the shell.
 *
 * The refusal is not `isWin32ShimSpawnFailure`'s case, so a direct spawn
 * killed on the deadline propagates out of the caller's `try` rather than
 * being retried through a shell: a child that ran too long on one leg has
 * nothing to say on the other.
 */
function captureAttempt(
  command: string,
  args: readonly string[],
  spawn: SyncSpawn,
  attempt: Attempt,
): string {
  const timeoutMs = spawn.timeoutMs ?? MAX_CHILD_MS;
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: spawn.cwd,
    ...(spawn.env === undefined ? {} : { env: spawn.env }),
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: timeoutMs,
    killSignal: KILL_SIGNAL,
    stdio: ["ignore", "pipe", "pipe"],
    ...(attempt === "shelled" ? { shell: true } : {}),
  };
  try {
    return execFileSync(command, args, options);
  } catch (err) {
    if (outranBound(err)) throw deadlineRefusal(command, args, timeoutMs, err);
    throw err;
  }
}

/**
 * A failure's own text — the stderr it carried where it has one, else its
 * message, else the thrown value said out loud.
 *
 * stderr first because that is where a child states what went wrong, while
 * the error node builds around it leads with the command line the caller
 * already has. A caller whose failures never come from a spawn reaches the
 * message arm and reads exactly what it read before.
 */
export function detailOf(err: unknown): string {
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  return (thrownMessage(err)).trim();
}

/**
 * The exit status a failed child carried, where it exited at all.
 *
 * `undefined` for a failure that is not a child's own answer — a binary the
 * host does not have, a signal — which is exactly the case a caller keying on
 * one specific status has to tell from that status: a tool saying "no" in the
 * number it reserves for "no" is the tool speaking, and everything else is
 * not (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * `status` because these spawns are `execFileSync`'s, which is where node puts
 * a child's exit code; the engine's own async spawns carry the same number as
 * `code` (`src/git.ts`). Read here once so the callers that key on a status —
 * a detached HEAD against a broken git (`ci.ts`), a cursor naming no commit
 * against a tree git will not read (`gitRange.ts`) — share the decode rather
 * than each casting for the field (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 */
export function exitStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
