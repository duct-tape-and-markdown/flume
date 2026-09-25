/**
 * The win32 `.cmd`-shim retry decision, driven on every host.
 *
 * The three sites that spawn a possibly-shimmed binary — `shellGate`
 * (src/builtinGates.ts), `setupWorktree` (src/setupWorktree.ts) and
 * `claudeCode` (src/claudeCode.ts) — used to spell the detection themselves, and
 * `shellGate`'s copy was exercised only under `describe.runIf(win32)`, which
 * runs in none of this repo's runs. Here the platform is a shim of its own
 * (`withPlatform`) and `execFile` is mocked, so the decision — retry, or
 * propagate — is judged on the host the suite actually runs on.
 */

import { execFile, execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const mock = vi.fn();
  const syncMock = vi.fn();
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
  return { ...actual, execFile: mock, execFileSync: syncMock };
});

import { shellGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
import { shellArgs } from "../harness/declaredShell.ts";
import { captureSync } from "../harness/exec.ts";
import {
  execFileWithShimRetry,
  isWin32ShimSpawnFailure,
  wordShimRetryWouldRewrite,
} from "../src/spawnShim.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const execFileMock = vi.mocked(execFile);
const execFileSyncMock = vi.mocked(execFileSync);

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

/** The same swap for a case whose subject is synchronous. */
function withPlatformSync(platform: NodeJS.Platform, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

beforeEach(() => {
  execFileMock.mockReset();
  execFileSyncMock.mockReset();
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

  it("the argv verdict names the first word cmd.exe would rewrite, and passes an argv of bare flags", () => {
    // Each arm is a way the re-parse damages a word: the split, the quote it
    // eats, a metacharacter it acts on, an expansion it performs, and the
    // empty word the join drops entirely.
    expect(wordShimRetryWouldRewrite(["bash", "-c", "pnpm test"])).toBe(
      "pnpm test",
    );
    expect(wordShimRetryWouldRewrite(["claude", "--settings", '{"hooks":{}}'])).toBe(
      '{"hooks":{}}',
    );
    expect(wordShimRetryWouldRewrite(["git", "log", "--format=%H%x00%s"])).toBe(
      "--format=%H%x00%s",
    );
    expect(wordShimRetryWouldRewrite(["sh", "-c", "a&b"])).toBe("a&b");
    expect(wordShimRetryWouldRewrite(["pnpm", ""])).toBe("");
    // The command is a word of that line too, so a binary whose path splits
    // is refused on the same terms as an argument that does.
    expect(
      wordShimRetryWouldRewrite(["C:\\Program Files\\pnpm.cmd", "install"]),
    ).toBe("C:\\Program Files\\pnpm.cmd");
    // The argv the shipped retries actually carry survives, so the refusal
    // above is a verdict on the word rather than on every retry.
    expect(
      wordShimRetryWouldRewrite(["pnpm", "install", "--frozen-lockfile"]),
    ).toBeUndefined();
    expect(
      wordShimRetryWouldRewrite(["C:\\wt\\pnpm.cmd", "tsc", "--noEmit"]),
    ).toBeUndefined();
  });

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

/**
 * The retry's refusal, driven through the argv a declared shell gate really
 * hands it: `shellArgs` (`harness/declaredShell.ts`) puts a consumer's whole
 * command line on the argv as one word, and a shell re-parse would hand the
 * shim some other command rather than that one
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
it("execFileWithShimRetry refuses the win32 shim retry when an argv word would not survive the shell's re-parse", async () => {
  await withPlatform("win32", async () => {
    // The shell attempt resolves if it is made, so a single call below is the
    // refusal deciding rather than a fallback that was never there.
    enoentUntilShell("shim-ok");

    const line = "pnpm vitest run --reporter dot";
    const caught = await execFileWithShimRetry("bash", shellArgs(line), {
      cwd: "C:\\wt",
    }).catch((err: unknown) => err);

    expect(execFileMock).toHaveBeenCalledOnce();
    expect(optsOf(0).shell).toBeUndefined();
    expect(caught).toBeInstanceOf(Error);
    // Named, so the consumer reads which of its words it must respell.
    expect((caught as Error).message).toContain(line);
    expect((caught as Error).message).toContain("bash");
    // The spawn failure the caller is really looking at stays reachable.
    expect((caught as Error).cause).toMatchObject({ code: "ENOENT" });
  });
}, SPAWN_BUDGET_MS);

/**
 * The same refusal on the synchronous leg (`captureSync`, `harness/exec.ts`),
 * whose callers spawn a declared shell with a command line and git with a
 * `--format` string — two argvs `cmd.exe` rewrites rather than forwards.
 */
it("captureSync refuses the win32 shim retry over an argv word cmd.exe would rewrite", () => {
  withPlatformSync("win32", () => {
    execFileSyncMock.mockImplementation(((
      _cmd: string,
      _args: string[],
      opts: { shell?: boolean },
    ) => {
      if (opts.shell) return "shim-ok";
      throw errno("ENOENT");
    }) as never);

    expect(() =>
      captureSync("git", ["log", "--format=%H"], { cwd: "C:\\wt" }),
    ).toThrow(/--format=%H/);
    expect(execFileSyncMock).toHaveBeenCalledOnce();

    // An argv every word of which survives still retries, so the refusal is
    // not the sync leg refusing the fallback outright.
    execFileSyncMock.mockClear();
    expect(captureSync("git", ["rev-parse", "HEAD"], { cwd: "C:\\wt" })).toBe(
      "shim-ok",
    );
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
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
