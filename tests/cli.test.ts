/**
 * §12 / §14 — CLI env canonicalization.
 *
 * After resolution, `process.env.FLUME_DIR` / `process.env.FLUME_CONFIG_DIR`
 * must hold the **absolute resolved** state root, so a chain loaded later in
 * the same process (and any spawned child) reads one canonical value rather
 * than re-deriving the default or a coincidentally-equal `configDir`. Exercised
 * at the resolution seam (`resolveStateDirs`) for the env-unset (default) and
 * env-set-relative cases.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { resolveStateDirs, tickExitCode } from "../src/cli.ts";
import { EX_TERMINAL_MISCONFIG, type TickOutcome } from "../src/Dispatcher.ts";

const exec = promisify(execFile);

const repoRoot = "/repo/root";

describe("resolveStateDirs", () => {
  it("defaults both roots to <repoRoot>/.flume and writes them back absolute when env is unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    const expected = join(repoRoot, ".flume");
    expect(flumeDir).toBe(expected);
    expect(configDir).toBe(expected);
    expect(isAbsolute(flumeDir)).toBe(true);
    expect(isAbsolute(configDir)).toBe(true);

    // Canonicalized back into the env for later chain loads / spawned children.
    expect(env.FLUME_DIR).toBe(expected);
    expect(env.FLUME_CONFIG_DIR).toBe(expected);
  });

  it("resolves a set-but-relative FLUME_DIR / FLUME_CONFIG_DIR to absolute and writes it back", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: "tmp/dock",
      FLUME_CONFIG_DIR: "tmp/cfg",
    };
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    // resolve() is cwd-relative — the canonical form is absolute regardless.
    expect(flumeDir).toBe(resolve("tmp/dock"));
    expect(configDir).toBe(resolve("tmp/cfg"));
    expect(isAbsolute(flumeDir)).toBe(true);
    expect(isAbsolute(configDir)).toBe(true);

    expect(env.FLUME_DIR).toBe(flumeDir);
    expect(env.FLUME_CONFIG_DIR).toBe(configDir);
  });

  it("leaves an already-absolute FLUME_DIR untouched and independent of configDir", () => {
    // resolve() drive-qualifies on win32, so the fixture is absolute on
    // every platform — the untouched assertion needs a true absolute input.
    const dockState = resolve("/var/dock/state");
    const flumeConfig = resolve("/etc/flume/config");
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: dockState,
      FLUME_CONFIG_DIR: flumeConfig,
    };
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe(dockState);
    expect(configDir).toBe(flumeConfig);
    expect(env.FLUME_DIR).toBe(dockState);
    expect(env.FLUME_CONFIG_DIR).toBe(flumeConfig);
  });
});

/**
 * §3 — `flume tick` exit-code classification at the process boundary:
 * 78 (`EX_CONFIG`) terminal misconfiguration, 1 chain-resolution failure,
 * 0 clean hibernate or ordinary work. Exercised at the mapping seam
 * (`tickExitCode`); the loop-process-boundary integration suite proves 78
 * end-to-end through a real subprocess.
 */
describe("tickExitCode — §3 axis classification", () => {
  it("terminal misconfiguration → 78 (EX_CONFIG)", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      terminal: { kind: "orphaned-awake", phases: ["ghost"] },
      awakeAfter: ["ghost"],
      summary: "awake flags reference unknown phases: ghost",
    };
    expect(EX_TERMINAL_MISCONFIG).toBe(78);
    expect(tickExitCode(outcome)).toBe(78);
  });

  it("clean hibernation → 0", () => {
    const outcome: TickOutcome = {
      hibernated: true,
      awakeAfter: [],
      summary: "no phases awake; hibernating",
    };
    expect(tickExitCode(outcome)).toBe(0);
  });

  it("chain resolution failure (§3, other Axis-C member) → 1", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      failed: true,
      awakeAfter: ["plan"],
      summary: "chain resolution failed: boom; no work",
    };
    expect(tickExitCode(outcome)).toBe(1);
  });

  it("ordinary work tick → 0", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      phaseName: "plan",
      awakeAfter: ["build"],
      summary: "plan committed abcd1234 → build",
    };
    expect(tickExitCode(outcome)).toBe(0);
  });
});

/**
 * v0.4 §2a — cross-process loop lock at `<flumeDir>/loop.pid`. One supervisor
 * per state root: a second `flume loop` is refused while the recorded pid is
 * alive; a stale pidfile (dead pid) is reclaimed.
 *
 * The lock branch resolves before `superviseLoop` spawns any child tick, so
 * `--max 0` exercises both outcomes with a single real CLI subprocess each —
 * no chain.ts, no git repo, no child processes. That keeps these fast-lane
 * safe despite spawning the real `flume loop` (the lock lives inline in the
 * CLI's `main()`; only a real process can exercise it).
 */

// Run the source CLI through the project's own `tsx` (no build step) — via
// `node <tsx cli.mjs>`, not the `.bin/tsx` shim, which is a `.cmd` shell
// script on win32 that `execFile` cannot spawn without a shell (§6 spawn
// discipline). Absolute paths so cwd can be the temp state root.
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX_CLI = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);

/**
 * A copy of this process's env with the canonical FLUME_DIR /
 * FLUME_CONFIG_DIR stripped, so the spawned loop resolves the temp dir's
 * `.flume` default. Without this the suite is not hermetic: run under a
 * flume harness (whose canonicalized env the vitest process inherits), the
 * child would lock — or refuse against — the outer state root.
 */
function hermeticEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FLUME_DIR;
  delete env.FLUME_CONFIG_DIR;
  return env;
}

/** Spawn one real `flume loop --max <max>`; collect output + exit code. */
async function runLoop(
  cwd: string,
  max: number,
): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [TSX_CLI, CLI, "loop", "--max", String(max)],
      { cwd, env: hermeticEnv() },
    );
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

describe("§2a cross-process loop lock — real `flume loop` against <flumeDir>/loop.pid", () => {
  it(
    "refuses a second loop while the recorded pid is alive, leaving the pidfile untouched",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-lock-"));
      try {
        const flumeDir = join(dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // The vitest worker itself plays the live prior supervisor — its pid
        // is guaranteed alive for the duration of the spawned loop.
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(process.pid), "utf8");

        const r = await runLoop(dir, 0);

        expect(r.code).toBe(1);
        expect(r.out).toContain(
          `another loop (pid ${process.pid}) already runs`,
        );
        // The refusal names the state root — the lock's scope is flumeDir,
        // not the repo (§2a: a relocated dock carries its lock with it).
        expect(r.out).toContain(flumeDir);
        expect(r.out).toContain("refusing");
        // The holder's pidfile survives the refused contender untouched.
        expect(await readFile(pidPath, "utf8")).toBe(String(process.pid));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "reclaims a stale pidfile (dead pid): the loop runs and drops the lock on exit",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-lock-"));
      try {
        const flumeDir = join(dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // Harvest a genuinely dead pid: spawn a no-op node child and wait
        // for it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        expect(deadPid).toBeDefined();
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(deadPid), "utf8");

        const r = await runLoop(dir, 0);

        // Not refused — the dead holder was reclaimed and the loop ran to
        // its --max 0 stop.
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("refusing");
        expect(r.out).toContain("reached --max 0");
        // The reclaiming loop took the lock over and dropped it on exit; a
        // refusal would have left the stale pidfile in place.
        expect(existsSync(pidPath)).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
