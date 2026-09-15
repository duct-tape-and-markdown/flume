/**
 * `src/processTree.ts` — the own-group spawn and the bounded teardown, driven
 * against real processes rather than a mocked `node:child_process`. The
 * subject is what the kernel does with a signal aimed at a process *group*,
 * so a stubbed spawn would pin this suite's own idea of reach instead of the
 * host's.
 *
 * The end-to-end property these mechanics exist for — a signalled `flume
 * loop` releasing its guards over a dead tree — is `tests/cli.test.ts`. Here
 * the halves are exercised apart, so a regression names the half that broke.
 *
 * Every case declares win32 as a skip rather than passing silently there:
 * that host has no process group to signal and maps SIGTERM to
 * TerminateProcess, which runs no handler and so leaves no disposition for a
 * grace to bound (spec/loop.md, "The loop lock and the tip claim"). Named
 * plainly rather than backticked, as `src/processTree.ts` names it: a Win32
 * entry point is not a declaration these trees hold.
 */

import type { ChildProcess } from "node:child_process";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  spawnProcessTree,
  terminateProcessTree,
  DEFAULT_KILL_GRACE_MS,
} from "../src/processTree.ts";

import { SPAWN_BUDGET_MS, mkTempDir, processAlive } from "./helpers/subprocess.ts";
import { fileWithContent, waitFor } from "./helpers/waitFor.ts";

/**
 * The grace a case escalating through it pays. Short enough to cost
 * milliseconds, long enough that a host under lane contention cannot deliver
 * the SIGKILL before a child with the default disposition would have gone on
 * the SIGTERM — which would make the escalation case green for the wrong
 * reason.
 */
const SHORT_GRACE_MS = 250;

/** The env var a parked child reports a pid through. */
const PID_FILE_VAR = "FLUME_TEST_PID_FILE";

/** A node one-liner that never finishes on its own. */
const PARK = "setInterval(() => {}, 1000);";

/** Every child a case spawned, so a failed assertion leaks no parked tree. */
const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const child of spawned.splice(0)) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone — the case's own teardown got there first
    }
  }
});

/** Spawn `script` under `node -e`, tracked for teardown. */
function park(script: string, pidFile?: string): ChildProcess {
  const child = spawnProcessTree(process.execPath, ["-e", script], {
    // `ignore`: a parked tree holding this process's stdio open is one more
    // thing a failing case would have to explain.
    stdio: "ignore",
    ...(pidFile !== undefined
      ? { env: { ...process.env, [PID_FILE_VAR]: pidFile } }
      : {}),
  });
  spawned.push(child);
  return child;
}

/** How the child ended: its exit code and the signal that ended it. */
function ended(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

describe("terminateProcessTree — the signal reaches the whole tree", () => {
  it.skipIf(process.platform === "win32")(
    "a grandchild the terminated child spawned is signalled with it, not reparented and left running",
    async () => {
      const scratch = await mkTempDir("flume-process-tree-");
      const pidFile = join(scratch, "grandchild.pid");
      // The child spawns one grandchild and reports its pid: `spawn` returns
      // once the OS holds the process, which is what "alive" reads below.
      const child = park(
        `const { spawn } = require("node:child_process");` +
          `const kid = spawn(process.execPath, ["-e", ${JSON.stringify(PARK)}], { stdio: "ignore" });` +
          `require("node:fs").writeFileSync(process.env[${JSON.stringify(PID_FILE_VAR)}], String(kid.pid));` +
          PARK,
        pidFile,
      );
      const grandchildPid = Number(
        await waitFor(
          `the child to report its grandchild's pid at ${pidFile}`,
          () => fileWithContent(pidFile),
        ),
      );

      // Non-vacuity: the subject below is a live process distinct from the
      // child, or "the grandchild died" is green over one that never ran.
      expect(grandchildPid).not.toBe(child.pid);
      expect(processAlive(grandchildPid)).toBe(true);

      terminateProcessTree(child, { graceMs: SHORT_GRACE_MS });
      await ended(child);

      // The group signal reaches every member at once, but the members exit
      // independently — the child's own `exit` orders nothing about its
      // descendants — so the grandchild's death is awaited rather than read
      // off that same instant. Signalled through the child handle alone this
      // wait runs out: the grandchild is reparented and parks on.
      await waitFor(
        `the grandchild (pid ${grandchildPid}) to go down with the tree`,
        () => (processAlive(grandchildPid) ? undefined : "gone"),
      );
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a child that ignores SIGTERM is killed once the grace runs out",
    async () => {
      const scratch = await mkTempDir("flume-process-tree-");
      const pidFile = join(scratch, "ready.pid");
      // The pid file is the readiness event, not a bookkeeping write: a
      // SIGTERM landing before node has evaluated this script meets the
      // default disposition and ends the child, which would green this case
      // with no escalation involved.
      const child = park(
        `process.on("SIGTERM", () => {});` +
          `require("node:fs").writeFileSync(process.env[${JSON.stringify(PID_FILE_VAR)}], String(process.pid));` +
          PARK,
        pidFile,
      );
      await waitFor(
        `the child to report it has installed its SIGTERM handler at ${pidFile}`,
        () => fileWithContent(pidFile),
      );

      terminateProcessTree(child, { graceMs: SHORT_GRACE_MS });
      const { signal } = await ended(child);

      // SIGKILL, not SIGTERM: the handler swallowed the first signal, so the
      // escalation is the only thing that could have ended this child.
      expect(signal).toBe("SIGKILL");
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a child that exits on SIGTERM never pays the engine's default grace",
    async () => {
      const child = park(PARK);

      const started = Date.now();
      // No grace declared, so the default applies — and a child with the
      // default disposition must not wait it out.
      terminateProcessTree(child);
      const { signal } = await ended(child);

      // SIGTERM, not SIGKILL: the default disposition ended this child, so
      // the escalation never fired on it.
      expect(signal).toBe("SIGTERM");
      // A ceiling, not a cost — it is the *waiting* that is being denied. Half
      // the default is still orders of magnitude above what delivering one
      // SIGTERM to a parked child takes on a loaded host, so nothing but a
      // teardown that sat out the grace can cross it.
      expect(Date.now() - started).toBeLessThan(DEFAULT_KILL_GRACE_MS / 2);
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "terminating a child that has already exited signals nothing",
    async () => {
      const child = park("");
      const { code } = await ended(child);

      // Non-vacuity: the child is finished and reaped before the terminate
      // below — the state whose pid the host is free to hand to a stranger.
      expect(code).toBe(0);
      expect(child.exitCode).toBe(0);

      expect(() =>
        terminateProcessTree(child, { graceMs: SHORT_GRACE_MS }),
      ).not.toThrow();
    },
    SPAWN_BUDGET_MS,
  );
});
