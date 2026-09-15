/**
 * processTree — the own-group spawn, and the bounded teardown that takes the
 * whole spawned tree down with one signal.
 *
 * `ChildProcess.kill` reaches the direct child and nothing that child
 * spawned: a grandchild is reparented and keeps running. For this engine
 * that grandchild is an agent still writing under a state root whose guards
 * the signalled process is about to release (spec/loop.md, "The loop lock and
 * the tip claim"), so the guard drops with a writer still inside what it
 * protected. Spawning the child as its own process group leader is what lets
 * one signal reach the tree; the escalation below is what bounds the wait,
 * which a bare SIGTERM leaves to whatever disposition the tree happens to
 * install.
 *
 * POSIX only, as that section states: win32 has no process group to signal,
 * and maps SIGTERM to TerminateProcess, which runs no handler. There
 * {@link spawnProcessTree} spawns exactly as `spawn` would and
 * {@link terminateProcessTree} signals the child alone — the same reach
 * `ChildProcess.kill` already had, never a silently wider one.
 *
 * Sibling to `fsProbe.ts` and `spawnShim.ts`: nothing beyond
 * `node:child_process` here, so any module that spawns can reach it without
 * a cycle.
 */

import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

/**
 * Engine default for the wait between a tick tree's SIGTERM and its SIGKILL,
 * in milliseconds — the grace {@link terminateProcessTree} applies absent a
 * chain's `supervisorPolicy.killGraceMs` (`src/Phase.ts`). One home: the
 * chain-facing option's hover text points here rather than restating the
 * number beside it.
 *
 * Sized as a flush window, not a guess at how long a well-behaved tree takes
 * to go: a child with the default disposition exits on the SIGTERM and the
 * escalation is cancelled at its `exit`, so nothing pays this but a tree that
 * installed a handler and is using it.
 */
export const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Whether this host has process groups to spawn into and to signal. Read at
 * call time rather than at module load, so a caller (and this repo's suite)
 * can exercise the decision on any host.
 */
function hasProcessGroups(): boolean {
  return process.platform !== "win32";
}

/**
 * `spawn`, with the child made leader of its own process group where the host
 * has them — which is what {@link terminateProcessTree} signals. Every other
 * option is the caller's, untouched.
 *
 * `detached` also takes the child out of the terminal's foreground process
 * group, so a Ctrl-C at an interactive `flume loop` reaches the supervisor
 * alone and the supervisor's own teardown becomes the one path down. That is
 * the point rather than a side effect: a child signalled by the terminal *and*
 * by its parent races the parent's release against a death it never ordered.
 */
export function spawnProcessTree(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, [...args], {
    ...options,
    ...(hasProcessGroups() ? { detached: true } : {}),
  });
}

/**
 * Signal `child`'s whole tree, returning whether the signal was delivered.
 *
 * `false` means there was nothing to signal — the spawn never produced a pid,
 * the child has already exited, or the group is gone (`ESRCH`), which is the
 * state the caller is asking for rather than a degradation. Any other failure
 * — an `EPERM` says the tree is there and not ours to signal — is the
 * caller's to see (`.claude/rules/engineering.md`, "Loud or nothing").
 */
function signalTree(child: ChildProcess, signal: NodeJS.Signals): boolean {
  const { pid } = child;
  if (pid === undefined) return false;
  // Already reaped: its pid may since have been recycled onto an unrelated
  // process, and signalling it would kill a stranger.
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try {
    // A negative pid is the process group's, and the child leads its own
    // because `spawnProcessTree` spawned it detached.
    process.kill(hasProcessGroups() ? -pid : pid, signal);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

/**
 * Take `child` and everything it spawned down: SIGTERM the tree now, SIGKILL
 * it after `graceMs` if it is still there. Returns immediately — the caller
 * settles on the child's own `exit`, which is what proves the tree is gone
 * rather than merely asked to go.
 *
 * The escalation timer is cleared at that `exit`, so a tree with the default
 * disposition never pays the grace, and the SIGKILL can never land on a pid
 * the host has since recycled.
 *
 * Defaults to {@link DEFAULT_KILL_GRACE_MS}; the CLI forwards a chain's
 * `supervisorPolicy.killGraceMs` (`src/Phase.ts`) here through
 * `superviseLoop` (`src/loopSupervisor.ts`).
 */
export function terminateProcessTree(
  child: ChildProcess,
  opts: { graceMs?: number } = {},
): void {
  if (!signalTree(child, "SIGTERM")) return;
  const escalate = setTimeout(() => {
    signalTree(child, "SIGKILL");
  }, opts.graceMs ?? DEFAULT_KILL_GRACE_MS);
  child.once("exit", () => clearTimeout(escalate));
}
