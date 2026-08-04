import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { setupWorktree } from "../src/setupWorktree.js";

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
    dir = await mkdtemp(join(tmpdir(), "flume-setup-worktree-"));
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
  });

  it("runs npm ci when package-lock.json is present", async () => {
    await writeFile(join(dir, "package-lock.json"), "{}\n");
    succeeds();

    await setupWorktree(dir);

    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args, opts] = execFileMock.mock.calls[0]!;
    expect(cmd).toBe("npm");
    expect(args).toEqual(["ci"]);
    expect((opts as { cwd: string }).cwd).toBe(dir);
  });

  it("prefers pnpm when both lockfiles are present", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(dir, "package-lock.json"), "{}\n");
    succeeds();

    await setupWorktree(dir);

    expect(execFileMock).toHaveBeenCalledOnce();
    expect(execFileMock.mock.calls[0]![0]).toBe("pnpm");
  });

  it("refuses cleanly when neither lockfile is present", async () => {
    await expect(setupWorktree(dir)).rejects.toThrow(
      /no pnpm-lock\.yaml or package-lock\.json/,
    );
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
  });

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
