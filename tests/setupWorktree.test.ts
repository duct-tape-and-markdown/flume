import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { setupWorktree } from "../src/setupWorktree.js";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const execFileMock = vi.mocked(execFile);

function succeeds() {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(null, "", "");
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

function enoentThenSucceeds() {
  let calls = 0;
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("spawn pnpm ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err, "", "");
    } else {
      cb(null, "", "");
    }
    return {} as never;
  }) as never);
}

function failsWith(code: string) {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const err = new Error(`spawn pnpm ${code}`) as NodeJS.ErrnoException;
    err.code = code;
    cb(err, "", "");
    return {} as never;
  }) as never);
}

describe("setupWorktree", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkTempDir("flume-setup-worktree-");
    execFileMock.mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs pnpm install --frozen-lockfile when pnpm-lock.yaml is present", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    succeeds();

    await setupWorktree(dir);

    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args, opts] = execFileMock.mock.calls[0]!;
    expect(cmd).toBe("pnpm");
    expect(args).toEqual(["install", "--frozen-lockfile"]);
    expect((opts as { cwd: string }).cwd).toBe(dir);
  }, SPAWN_BUDGET_MS);

  it("runs npm ci when package-lock.json is present", async () => {
    await writeFile(join(dir, "package-lock.json"), "{}\n");
    succeeds();

    await setupWorktree(dir);

    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args, opts] = execFileMock.mock.calls[0]!;
    expect(cmd).toBe("npm");
    expect(args).toEqual(["ci"]);
    expect((opts as { cwd: string }).cwd).toBe(dir);
  }, SPAWN_BUDGET_MS);

  it("prefers pnpm when both lockfiles are present", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(dir, "package-lock.json"), "{}\n");
    succeeds();

    await setupWorktree(dir);

    expect(execFileMock).toHaveBeenCalledOnce();
    expect(execFileMock.mock.calls[0]![0]).toBe("pnpm");
  }, SPAWN_BUDGET_MS);

  it("refuses cleanly when neither lockfile is present", async () => {
    await expect(setupWorktree(dir)).rejects.toThrow(
      /no pnpm-lock\.yaml or package-lock\.json/,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  // `existsSync` collapsed every stat failure to `false`, so a lockfile that
  // is on disk but unstattable read as absent and the hook answered anyway:
  // a pnpm repo demoted to `npm ci`, or an npm repo told it committed no
  // lockfile at all. The probes now split ENOENT from the rest
  // (`existsLoud`, src/fsProbe.ts), so the refusal lands before any install.
  it("setupWorktree throws when pnpm-lock.yaml is present but unstattable", async () => {
    const lock = join(dir, "pnpm-lock.yaml");
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink("pnpm-lock.yaml", lock);
    // The readable npm lockfile beside it is what the demotion needed: with
    // the pnpm probe reading `false`, the old code ran `npm ci` in a pnpm
    // repo without ever reporting that it could not read the pnpm lock.
    await writeFile(join(dir, "package-lock.json"), "{}\n");
    succeeds();

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): something really is at the path, and the stat
    // that decides really does fail on it.
    expect((await lstat(lock)).isSymbolicLink()).toBe(true);
    expect(existsSync(lock)).toBe(false);

    await expect(setupWorktree(dir)).rejects.toThrow(/ELOOP/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("setupWorktree throws when package-lock.json is present but unstattable", async () => {
    const lock = join(dir, "package-lock.json");
    // ELOOP — present, unstattable. The pnpm probe legitimately reads absent
    // here, so this is the second probe deciding, and the old code's answer
    // was the no-lockfile refusal over a repo that committed one.
    await symlink("package-lock.json", lock);
    succeeds();

    expect((await lstat(lock)).isSymbolicLink()).toBe(true);
    expect(existsSync(lock)).toBe(false);

    await expect(setupWorktree(dir)).rejects.toThrow(/ELOOP/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("propagates the install command's failure", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    execFileMock.mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(new Error("frozen lockfile out of date"), "", "");
      return {} as never;
    }) as never);

    await expect(setupWorktree(dir)).rejects.toThrow(
      /frozen lockfile out of date/,
    );
  });

  it("spawns pnpm direct (no shell) when the direct spawn succeeds", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    succeeds();

    await setupWorktree(dir);

    expect(execFileMock).toHaveBeenCalledOnce();
    const [, , opts] = execFileMock.mock.calls[0]!;
    expect((opts as { shell?: boolean }).shell).toBeUndefined();
  });

  it("on win32, a direct-spawn ENOENT retries once through the shell and succeeds", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    enoentThenSucceeds();

    await withPlatform("win32", async () => {
      await expect(setupWorktree(dir)).resolves.toBeUndefined();
    });

    expect(execFileMock).toHaveBeenCalledTimes(2);
    const [firstCmd, firstArgs, firstOpts] = execFileMock.mock.calls[0]!;
    expect(firstCmd).toBe("pnpm");
    expect(firstArgs).toEqual(["install", "--frozen-lockfile"]);
    expect((firstOpts as { shell?: boolean }).shell).toBeUndefined();

    const [secondCmd, secondArgs, secondOpts] = execFileMock.mock.calls[1]!;
    expect(secondCmd).toBe("pnpm");
    expect(secondArgs).toEqual(["install", "--frozen-lockfile"]);
    expect((secondOpts as { shell?: boolean }).shell).toBe(true);
  }, SPAWN_BUDGET_MS);

  it("on non-win32, a direct-spawn ENOENT propagates without retrying through the shell", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    failsWith("ENOENT");

    await withPlatform("linux", async () => {
      await expect(setupWorktree(dir)).rejects.toThrow(/ENOENT/);
    });

    expect(execFileMock).toHaveBeenCalledOnce();
  });

  it("on win32, a non-ENOENT error propagates without retrying through the shell", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    failsWith("EACCES");

    await withPlatform("win32", async () => {
      await expect(setupWorktree(dir)).rejects.toThrow(/EACCES/);
    });

    expect(execFileMock).toHaveBeenCalledOnce();
  });
});
