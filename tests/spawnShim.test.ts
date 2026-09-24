/**
 * The win32 `.cmd`-shim retry decision, driven on every host.
 *
 * The three sites that spawn a possibly-shimmed binary — `shellGate`
 * (src/builtinGates.ts), `setupWorktree` (src/setupWorktree.ts) and
 * `claudeCode` (src/Agent.ts) — used to spell the detection themselves, and
 * `shellGate`'s copy was exercised only under `describe.runIf(win32)`, which
 * runs in none of this repo's runs. Here the platform is a shim of its own
 * (`withPlatform`) and `execFile` is mocked, so the decision — retry, or
 * propagate — is judged on the host the suite actually runs on.
 */

import { execFile } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const mock = vi.fn();
  // The real `execFile` carries a `promisify.custom` that resolves
  // `{ stdout, stderr }`. Without it the promisified mock would resolve a
  // bare stdout string and every caller's destructuring would read
  // `undefined` — a mock lying about the shape it stands in for
  // (`.claude/rules/engineering.md`, "A seam gate reads what the real
  // writer wrote" is the same instinct one layer down).
  Object.defineProperty(mock, promisify.custom, {
    value: (cmd: string, args: string[], opts: unknown) =>
      new Promise((resolve, reject) => {
        mock(cmd, args, opts, (err: Error | null, stdout: string, stderr: string) =>
          err ? reject(err) : resolve({ stdout, stderr }),
        );
      }),
  });
  return { ...actual, execFile: mock };
});

import { shellGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
import {
  execFileWithShimRetry,
  isWin32ShimSpawnFailure,
} from "../src/spawnShim.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const execFileMock = vi.mocked(execFile);

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

/** The opts each recorded call was spawned with. */
const optsOf = (call: number): { shell?: boolean } =>
  execFileMock.mock.calls[call]![2] as { shell?: boolean };

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(`spawn pnpm ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** Fails every attempt with `code`. */
function alwaysFails(code: string): void {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: ExecCb,
  ) => {
    cb(errno(code), "", "");
    return {} as never;
  }) as never);
}

/** ENOENTs the direct spawn, succeeds whenever a shell is asked for. */
function enoentUntilShell(stdout: string): void {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    opts: { shell?: boolean },
    cb: ExecCb,
  ) => {
    if (opts.shell) cb(null, stdout, "");
    else cb(errno("ENOENT"), "", "");
    return {} as never;
  }) as never);
}

async function withPlatform(
  platform: NodeJS.Platform,
  fn: () => Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe("spawnShim — the shared retry decision", () => {
  it("a win32 ENOENT from the direct spawn retries once through the shell", async () => {
    await withPlatform("win32", async () => {
      enoentUntilShell("shim-ok");

      const { stdout } = await execFileWithShimRetry("pnpm", ["install"], {
        cwd: "C:\\wt",
      });

      expect(stdout).toBe("shim-ok");
      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(optsOf(0).shell).toBeUndefined();
      expect(optsOf(1).shell).toBe(true);
      // The shelled attempt keeps the caller's own options, which is what
      // makes the retry the same spawn rather than a different one.
      expect(execFileMock.mock.calls[1]![0]).toBe("pnpm");
      expect(execFileMock.mock.calls[1]![1]).toEqual(["install"]);
      expect((optsOf(1) as { cwd?: string }).cwd).toBe("C:\\wt");
    });
  }, SPAWN_BUDGET_MS);

  it("a shelled retry that ENOENTs again is the failure the caller sees — no third attempt", async () => {
    await withPlatform("win32", async () => {
      alwaysFails("ENOENT");

      await expect(
        execFileWithShimRetry("pnpm", ["install"], { cwd: "C:\\wt" }),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(execFileMock).toHaveBeenCalledTimes(2);
    });
  }, SPAWN_BUDGET_MS);

  it("a non-ENOENT win32 spawn failure propagates without a shell retry", async () => {
    await withPlatform("win32", async () => {
      alwaysFails("EACCES");

      await expect(
        execFileWithShimRetry("pnpm", ["install"], { cwd: "C:\\wt" }),
      ).rejects.toMatchObject({ code: "EACCES" });
      expect(execFileMock).toHaveBeenCalledOnce();
      expect(optsOf(0).shell).toBeUndefined();
    });
  }, SPAWN_BUDGET_MS);

  it("an ENOENT on a non-win32 host propagates without a shell retry", async () => {
    await withPlatform("linux", async () => {
      // The shell would turn this green if it ran — so the single call is
      // the decision, not an absent fallback path.
      enoentUntilShell("shim-ok");

      await expect(
        execFileWithShimRetry("pnpm", ["install"], { cwd: "/tmp" }),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(execFileMock).toHaveBeenCalledOnce();
      expect(optsOf(0).shell).toBeUndefined();
    });
  }, SPAWN_BUDGET_MS);

  it("the predicate reads the platform at call time, so one error answers differently per host", async () => {
    const err = errno("ENOENT");
    await withPlatform("win32", async () => {
      expect(isWin32ShimSpawnFailure(err)).toBe(true);
    });
    await withPlatform("linux", async () => {
      expect(isWin32ShimSpawnFailure(err)).toBe(false);
    });
    await withPlatform("win32", async () => {
      expect(isWin32ShimSpawnFailure(errno("EACCES"))).toBe(false);
      expect(isWin32ShimSpawnFailure(undefined)).toBe(false);
    });
  });
});

function ctx(cwd: string): GateContext {
  return {
    cwd,
    flumeDir: `${cwd}/.flume`,
    stateRootRel: ".flume",
    pendingDir: `${cwd}/.flume/plan/pending`,
    configDir: `${cwd}/.flume`,
    repoRoot: cwd,
    phaseName: "test-phase",
    commitSha: "c".repeat(40),
    baseSha: "b".repeat(40),
    touchedPaths: [],
    log: () => {},
  };
}

describe("shellGate — the shim retry it no longer spells itself", () => {
  it("shellGate retries a win32 ENOENT through the shell when the host is not win32", async () => {
    await withPlatform("win32", async () => {
      enoentUntilShell("shim-ok arg1");

      const gate = shellGate({
        name: "shim",
        when: "afterCommit",
        cmd: "flume-shim-fixture",
        args: ["arg1"],
      });
      const result = await gate.run(ctx("C:\\wt"));

      expect(result.ok).toBe(true);
      expect(result.message).toBe("shim green");
      expect(result.details).toBe("shim-ok arg1");
      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(optsOf(1).shell).toBe(true);
    });
  });

  it("shellGate reports a non-ENOENT win32 failure as a red gate, unretried", async () => {
    await withPlatform("win32", async () => {
      alwaysFails("EACCES");

      const gate = shellGate({
        name: "shim",
        when: "afterCommit",
        cmd: "flume-shim-fixture",
        args: [],
        failHint: "shim failed",
      });
      const result = await gate.run(ctx("C:\\wt"));

      expect(result.ok).toBe(false);
      expect(result.message).toBe("shim failed");
      expect(execFileMock).toHaveBeenCalledOnce();
    });
  });
});
