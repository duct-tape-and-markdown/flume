import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Partial mock: everything passes through to the real implementation except
// `rm`, which a single test below overrides once to simulate a removal
// fallback that resolves without actually clearing the directory — the
// deterministic, cross-platform stand-in for a locked-handle survivor that
// even the bounded-retry fallback (§7) cannot clear.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});

import {
  addWorktree,
  commitPaths,
  dropLastCommit,
  removeWorktree,
  revParse,
} from "../src/git.ts";

const exec = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "flume-git-"));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Byte-exact checkout on Windows: revert-path assertions compare file
  // content, and a host-level autocrlf=true would rewrite LF on reset.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
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

describe("dropLastCommit (§17, RELEASE-v0.7)", () => {
  it("refuses, naming both shas, when the current tip does not match the expected sha", async () => {
    const seedSha = await revParse(repo);
    await writeFile(join(repo, "extra.txt"), "unrelated work");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "someone else's commit"], {
      cwd: repo,
    });
    const currentTip = await revParse(repo);
    expect(currentTip).not.toBe(seedSha);

    await expect(dropLastCommit(repo, seedSha)).rejects.toThrow(
      new RegExp(`${currentTip}.*${seedSha}|${seedSha}.*${currentTip}`, "s"),
    );

    // Refusal leaves the tip in place.
    expect(await revParse(repo)).toBe(currentTip);
    expect(existsSync(join(repo, "extra.txt"))).toBe(true);
  });

  it("drops the commit when the current tip matches the expected sha", async () => {
    const seedSha = await revParse(repo);
    await writeFile(join(repo, "own.txt"), "this call's own commit");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "own commit"], { cwd: repo });
    const ownSha = await revParse(repo);

    await dropLastCommit(repo, ownSha);

    expect(await revParse(repo)).toBe(seedSha);
    expect(existsSync(join(repo, "own.txt"))).toBe(false);
  });
});

/**
 * v0.6.2 §7 — win32 worktree removal fallback. A bare `git worktree remove
 * --force` can fail and leave the directory (and its content) behind, most
 * commonly a pnpm-installed `node_modules` still held open. OS-level file
 * locks aren't reproducible portably in CI, so the failure trigger here is a
 * path git refuses for a different, deterministic reason (never registered
 * as a worktree) — the same downstream shape as the real bug: the bare
 * remove throws, real content survives, and the fallback must still clear
 * it.
 */
describe("removeWorktree (§7)", () => {
  afterEach(() => {
    vi.mocked(rm).mockClear();
  });

  it("removes a worktree that the bare remove clears cleanly", async () => {
    const wtPath = join(repo, "wt-clean");
    await addWorktree({
      repoRoot: repo,
      path: wtPath,
      branch: "flume/clean",
      fromRef: "HEAD",
    });

    // Clear immediately before the act: the outer afterEach's own
    // `rm(repo)` from the previous test runs after this describe's
    // mockClear (hooks run inner-then-outer), so it would otherwise leak
    // a stray call into this test's count.
    vi.mocked(rm).mockClear();
    await expect(removeWorktree(repo, wtPath)).resolves.toBeUndefined();
    expect(existsSync(wtPath)).toBe(false);
    // The bare `git worktree remove` cleared the directory itself — the
    // fallback's `rm` must never run, or this test can't tell the bare
    // path apart from the fallback path below.
    expect(rm).not.toHaveBeenCalled();
  });

  it("falls back to prune + recursive removal when the bare remove fails, clearing a populated tree", async () => {
    const path = join(repo, "not-a-registered-worktree");
    // Stand in for a populated node_modules survivor.
    await mkdir(join(path, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(
      join(path, "node_modules", "some-pkg", "index.js"),
      "module.exports = {};\n",
    );

    // Clear immediately before the act — see the note in the preceding
    // test.
    vi.mocked(rm).mockClear();
    // `git worktree remove --force` refuses a path it never registered —
    // deterministic across platforms, unlike a real locked-handle failure.
    await expect(removeWorktree(repo, path)).resolves.toBeUndefined();
    expect(existsSync(path)).toBe(false);
    // Clearing only happened because the fallback's recursive `rm` ran on
    // this exact path — proof the bare-remove failure actually fell
    // through to §7's fallback rather than clearing on its own.
    expect(rm).toHaveBeenCalledWith(
      path,
      expect.objectContaining({ recursive: true }),
    );
  });

  it("throws naming the path when even the fallback leaves it behind", async () => {
    const path = join(repo, "not-a-registered-worktree-stuck");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "locked.txt"), "held open\n");

    // Simulate a recursive removal that "succeeds" (no throw, e.g. the
    // process gave up retrying without surfacing an error) yet leaves the
    // directory behind — the locked-handle survivor §7 must still report.
    vi.mocked(rm).mockImplementationOnce(async () => {});

    await expect(removeWorktree(repo, path)).rejects.toThrow(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    expect(existsSync(path)).toBe(true);
  });
});
