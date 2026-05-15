import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitPaths, revParse } from "../src/git.ts";

const exec = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "flume-git-"));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(repo, ".seed"), "");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("revParse", () => {
  it("returns the full SHA of HEAD by default", async () => {
    const sha = await revParse(repo);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repo });
    expect(sha).toBe(stdout.trim());
  });

  it("resolves a named ref to its SHA", async () => {
    const { stdout: branchName } = await exec(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: repo },
    );
    const headSha = await revParse(repo);
    const branchSha = await revParse(repo, branchName.trim());
    expect(branchSha).toBe(headSha);
  });

  it("rejects when the ref does not exist", async () => {
    await expect(revParse(repo, "no-such-ref")).rejects.toThrow();
  });
});

describe("commitPaths", () => {
  it("stages only the listed paths and returns the new HEAD sha", async () => {
    await writeFile(join(repo, "tracked.txt"), "ship me");
    await writeFile(join(repo, "ignored.txt"), "leave me");

    const before = await revParse(repo);
    const sha = await commitPaths({
      cwd: repo,
      message: "ship one file",
      paths: ["tracked.txt"],
    });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sha).not.toBe(before);
    expect(sha).toBe(await revParse(repo));

    const { stdout: changed } = await exec(
      "git",
      ["show", "--name-only", "--pretty=format:", "HEAD"],
      { cwd: repo },
    );
    const files = changed.split("\n").map((s) => s.trim()).filter(Boolean);
    expect(files).toEqual(["tracked.txt"]);

    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(status).toContain("ignored.txt");
  });

  it("throws synchronously when no paths are supplied", async () => {
    await expect(
      commitPaths({ cwd: repo, message: "noop", paths: [] }),
    ).rejects.toThrow(/at least one path/);
  });
});
