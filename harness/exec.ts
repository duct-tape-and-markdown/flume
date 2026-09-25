/**
 * Reading a child process's output from inside a synchronous call: the spawn
 * itself, the bound on what comes back, and the status and text a failed one
 * carries.
 *
 * **Synchronous because a window's builder is.** The engine calls
 * `promptArgs` synchronously, and every tree and forge read the plan slices
 * make happens under one — the commits past a cursor (`gitRange.ts`), the
 * branch a repository's tip sits on and a lane's run on the forge
 * (`ci.ts`). The engine's own spawn wrapper is `async`
 * (`src/spawnShim.ts`), so the callers that can await take it there; this
 * module is so the ones that cannot each stop carrying their own copy of the
 * same three decisions (`.claude/rules/engineering.md`, *A module is one
 * job*).
 *
 * **Nothing here is caught.** A spawn that failed leaves as the error the
 * platform threw — its exit status, its errno, its stderr — for the caller
 * that knows what those mean: `branchAt` (`harness/ci.ts`) tells a detached
 * HEAD from a broken git by git's own exit status, and the lane reader tells
 * a forge CLI that is absent from one that refused by its errno
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). Wrapping the
 * failure would be this module deciding a meaning it was never given.
 */

import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

import { isWin32ShimSpawnFailure } from "../src/spawnShim.js";

/**
 * How much of one child's stdout is readable: a window-sized diff, a failing
 * job's whole log, a suite's JSON report. One number rather than one per
 * caller, because the bound is the same judgement each time — the point past
 * which the package is holding a runaway rather than material — and nothing
 * about the particular tool that printed it.
 */
export const MAX_OUTPUT_BYTES = 64 << 20;

/** What one invocation's caller states; every other option is this module's. */
interface SyncSpawn {
  /** The tree the child runs in. */
  readonly cwd: string;
  /** The child's environment, for a caller that has one to state. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * One child's stdout, or a throw carrying that child's own failure.
 *
 * stdin is closed and both output streams are piped: a child that would
 * otherwise wait on input fails instead of hanging the tick, and a failure's
 * stderr reaches {@link detailOf} rather than the operator's terminal.
 *
 * The win32 `.cmd`-shim retry rides every spawn here, under the engine's own
 * detection of it (`src/spawnShim.ts`): the direct spawn first, so arguments
 * keep exact quoting, then one shell retry on the single failure a shell can
 * still turn green. A caller spawning a real executable pays nothing for it
 * — the predicate is false everywhere but a win32 ENOENT — and the
 * alternative is each caller deciding for itself whether its binary is ever
 * shimmed, which is how the same decision came to be spelled two different
 * ways in this package.
 */
export function captureSync(
  command: string,
  args: readonly string[],
  spawn: SyncSpawn,
): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: spawn.cwd,
    ...(spawn.env === undefined ? {} : { env: spawn.env }),
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  };
  try {
    return execFileSync(command, args, options);
  } catch (err) {
    if (!isWin32ShimSpawnFailure(err)) throw err;
    return execFileSync(command, args, { ...options, shell: true });
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
  return (err instanceof Error ? err.message : String(err)).trim();
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
