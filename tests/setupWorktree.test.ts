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
});
