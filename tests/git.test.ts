import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Partial mock: everything passes through to the real implementation except
// `rm` and `unlink`. `rm` is overridden once by a single test below to
// simulate a removal fallback that resolves without actually clearing the
// directory — the deterministic, cross-platform stand-in for a
// locked-handle survivor that even the bounded-retry fallback (§7) cannot
// clear. `unlink` is overridden once by the tip-claim reclaim test to pin a
// non-ENOENT failure rethrowing instead of being swallowed.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm), unlink: vi.fn(actual.unlink) };
});

// Partial mock, same shape as the fs/promises one above: every call passes
// through to the real `execFile` (and its `util.promisify.custom`
// implementation, which is what `src/git.ts`'s `promisify(execFile)` actually
// invokes) except a single magic ref probed by the
// GIT-DELETEBRANCH-LOCALIZED-STDERR test below. No real git build in this
// environment ships a non-English catalog to test against (verified: a
// French locale env does not change git's own message here), so this fakes
// the one shape a localized git would produce — a `show-ref --verify` miss
// carrying non-English stderr — without touching any other call.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify: nodePromisify } = await import("node:util");
  const customPromisify = (
    actual.execFile as unknown as Record<symbol, unknown>
  )[nodePromisify.custom] as (
    ...args: unknown[]
  ) => Promise<{ stdout: string; stderr: string }>;
  const execFileMock = vi.fn(actual.execFile) as unknown as typeof actual.execFile;
  Object.defineProperty(execFileMock, nodePromisify.custom, {
    configurable: true,
    value: (...callArgs: unknown[]) => {
      const gitArgs = callArgs[1] as string[] | undefined;
      const targetsMissingBranch =
        (gitArgs?.[0] === "show-ref" &&
          gitArgs[3] === "refs/heads/localized-stderr-missing-branch") ||
        (gitArgs?.[0] === "branch" &&
          gitArgs[1] === "-D" &&
          gitArgs[2] === "localized-stderr-missing-branch");
      if (targetsMissingBranch) {
        return Promise.reject(
          Object.assign(
            new Error("fatal : la référence demandée n'existe pas"),
            {
              code: 1,
              stdout: "",
              stderr: "fatal : la référence demandée n'existe pas",
            },
          ),
        );
      }
      return customPromisify(...callArgs);
    },
  });
  return { ...actual, execFile: execFileMock };
});

import {
  acquireTipClaim,
  addWorktree,
  cherryPickRange,
  commitPaths,
  currentRefPath,
  deleteBranch,
  diffNameOnly,
  dropLastCommit,
  gitCommonDir,
  isAncestor,
  liveTipClaimPid,
  pinLongPaths,
  readFileAtRef,
  removeWorktree,
  resetKeepTo,
  ResetKeepRefusedError,
  revParse,
  softResetTo,
  tipClaimPath,
  TipClaimHeldError,
} from "../src/git.ts";

const exec = promisify(execFile);

// Test-only unwrap: these tests set up a real repo on a real branch, so
// `currentRefPath` always resolves a ref here — asserting that shape lets
// the tip-claim tests below key off the resolved path directly.
async function resolveRefPath(cwd: string): Promise<string> {
  const ref = await currentRefPath(cwd);
  if (ref.kind !== "ref") {
    throw new Error(`expected a resolved ref, got ${ref.kind}`);
  }
  return ref.path;
}

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

/**
 * spec/loop.md, "The loop lock and the tip claim": `git symbolic-ref` exits
 * non-zero for a detached HEAD, for a cwd outside any repository, and for a
 * `git` invocation that never ran at all — three causally-distinct states
 * `currentRefPath` must tell apart rather than folding into one `null`.
 */
describe("currentRefPath", () => {
  it("resolves the branch ref on a normal checkout", async () => {
    const ref = await currentRefPath(repo);
    expect(ref.kind).toBe("ref");
    if (ref.kind === "ref") {
      expect(ref.path).toMatch(/^refs\/heads\//);
    }
  });

  it("reports kind detached on a detached HEAD, distinct from a non-repository cwd", async () => {
    await exec("git", ["checkout", "-q", "--detach"], { cwd: repo });
    const ref = await currentRefPath(repo);
    expect(ref).toEqual({ kind: "detached" });
  });

  it("reports kind not-a-repository for a cwd outside any git working tree", async () => {
    const outside = await mkdtemp(join(tmpdir(), "flume-non-repo-"));
    try {
      const ref = await currentRefPath(outside);
      expect(ref).toEqual({ kind: "not-a-repository" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reports kind git-unavailable when the git process itself never runs", async () => {
    // A cwd that doesn't exist on disk fails at spawn (ENOENT), the same
    // shape node:child_process reports for a missing git binary — real
    // spawn failure, not a mocked stand-in.
    const missing = join(await mkdtemp(join(tmpdir(), "flume-missing-")), "gone");
    const ref = await currentRefPath(missing);
    expect(ref.kind).toBe("git-unavailable");
    if (ref.kind === "git-unavailable") {
      expect(ref.message.length).toBeGreaterThan(0);
    }
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

/**
 * spec/pending.md "Dispatch reads come from the tip, not the tree" —
 * `Dispatcher.readPending`'s tip-read primitive.
 */
describe("readFileAtRef (spec/pending.md 'Dispatch reads come from the tip, not the tree')", () => {
  it("returns a committed file's content at the given ref", async () => {
    await writeFile(join(repo, "committed.txt"), "committed content\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "add committed.txt"], {
      cwd: repo,
    });

    expect(await readFileAtRef(repo, "HEAD", "committed.txt")).toBe(
      "committed content\n",
    );
  });

  it("returns null for a path absent from the ref's tree, ignoring an uncommitted working-tree file of the same name", async () => {
    await writeFile(join(repo, "untracked.txt"), "never committed\n");
    expect(await readFileAtRef(repo, "HEAD", "untracked.txt")).toBeNull();
  });

  it("ignores an uncommitted edit to an otherwise-committed file — reads the committed content, not the dirty working tree", async () => {
    await writeFile(join(repo, "tracked.txt"), "committed version\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "add tracked.txt"], {
      cwd: repo,
    });
    await writeFile(join(repo, "tracked.txt"), "dirty uncommitted edit\n");

    expect(await readFileAtRef(repo, "HEAD", "tracked.txt")).toBe(
      "committed version\n",
    );
  });

  it("resolves a nested path with OS-native separators as a git pathspec", async () => {
    await mkdir(join(repo, "a", "b"), { recursive: true });
    await writeFile(join(repo, "a", "b", "c.txt"), "nested\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "add nested file"], {
      cwd: repo,
    });

    expect(await readFileAtRef(repo, "HEAD", join("a", "b", "c.txt"))).toBe(
      "nested\n",
    );
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

describe("isAncestor (spec/loop.md 'Tip verify', per-entry leg)", () => {
  it("reports true when ancestor is a real ancestor of descendant, however many commits back", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "one.txt"), "1");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "one"], { cwd: repo });
    await writeFile(join(repo, "two.txt"), "2");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "two"], { cwd: repo });
    const tip = await revParse(repo);

    expect(await isAncestor(repo, base, tip)).toBe(true);
  });

  it("reports true for a sha compared against itself (non-strict ancestry)", async () => {
    const sha = await revParse(repo);
    expect(await isAncestor(repo, sha, sha)).toBe(true);
  });

  it("reports false when the two shas diverged — neither descends from the other", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "left.txt"), "left");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "left branch"], { cwd: repo });
    const left = await revParse(repo);

    await exec("git", ["checkout", "-q", base], { cwd: repo });
    await writeFile(join(repo, "right.txt"), "right");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "right branch"], { cwd: repo });
    const right = await revParse(repo);

    expect(await isAncestor(repo, left, right)).toBe(false);
  });

  it("rethrows a failure the probe cannot explain rather than reading it as 'not an ancestor'", async () => {
    await expect(
      isAncestor(repo, "not-a-real-sha", await revParse(repo)),
    ).rejects.toThrow();
  });
});

describe("softResetTo (spec/loop.md 'Tip verify', per-entry leg)", () => {
  it("moves HEAD to the target sha while leaving the abandoned commits' content as uncommitted working-tree state", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "dropped.txt"), "dropped content");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "to be soft-reset away"], {
      cwd: repo,
    });

    await softResetTo(repo, base);

    expect(await revParse(repo)).toBe(base);
    expect(existsSync(join(repo, "dropped.txt"))).toBe(true);
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(status).toContain("dropped.txt");
  });

  it("resets to a target that is not an ancestor of the current tip, without throwing", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "left.txt"), "left");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "left branch"], { cwd: repo });
    const left = await revParse(repo);

    await exec("git", ["checkout", "-q", base], { cwd: repo });
    await writeFile(join(repo, "right.txt"), "right");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "right branch"], { cwd: repo });

    expect(await isAncestor(repo, left, await revParse(repo))).toBe(false);
    await expect(softResetTo(repo, left)).resolves.toBeUndefined();
    expect(await revParse(repo)).toBe(left);
  });
});

describe("resetKeepTo (spec/loop.md 'Tip verify', \"dropping it must not take bystanders\")", () => {
  it("moves the tip back and preserves an unrelated unstaged bystander edit", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "engine.txt"), "engine change");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "engine commit"], { cwd: repo });

    // A bystander's uncommitted edit to a file the engine's commit never
    // touched.
    await writeFile(join(repo, ".seed"), "bystander unstaged edit");

    await resetKeepTo(repo, base);

    expect(await revParse(repo)).toBe(base);
    expect(existsSync(join(repo, "engine.txt"))).toBe(false);
    expect(await readFile(join(repo, ".seed"), "utf8")).toBe(
      "bystander unstaged edit",
    );
  });

  it("moves the tip back and preserves an unrelated staged bystander edit", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "engine.txt"), "engine change");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "engine commit"], { cwd: repo });

    await writeFile(join(repo, ".seed"), "bystander staged edit");
    await exec("git", ["add", "."], { cwd: repo });

    await resetKeepTo(repo, base);

    expect(await revParse(repo)).toBe(base);
    const { stdout: status } = await exec(
      "git",
      ["status", "--porcelain"],
      { cwd: repo },
    );
    expect(status).toContain(".seed");
    expect(await readFile(join(repo, ".seed"), "utf8")).toBe(
      "bystander staged edit",
    );
  });

  it("refuses on a textual collision — unstaged bystander edit to the exact path the reset would touch — leaving both writers' content in place", async () => {
    await writeFile(join(repo, "shared.txt"), "base");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed shared.txt"], {
      cwd: repo,
    });
    const preEngine = await revParse(repo);
    await writeFile(join(repo, "shared.txt"), "base\nengine change");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "engine commit"], { cwd: repo });
    const postEngine = await revParse(repo);

    // Bystander edits the exact same file the revert needs to touch,
    // without committing or staging.
    await writeFile(
      join(repo, "shared.txt"),
      "base\nengine change\nbystander collision",
    );

    await expect(resetKeepTo(repo, preEngine)).rejects.toThrow(
      ResetKeepRefusedError,
    );

    // Refused: neither the engine's commit nor the bystander's edit moved.
    expect(await revParse(repo)).toBe(postEngine);
    expect(await readFile(join(repo, "shared.txt"), "utf8")).toBe(
      "base\nengine change\nbystander collision",
    );
  });

  it("refuses on a textual collision — staged bystander edit to the exact path the reset would touch — leaving both writers' content in place", async () => {
    await writeFile(join(repo, "shared.txt"), "base");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed shared.txt"], {
      cwd: repo,
    });
    const preEngine = await revParse(repo);
    await writeFile(join(repo, "shared.txt"), "base\nengine change");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "engine commit"], { cwd: repo });
    const postEngine = await revParse(repo);

    await writeFile(
      join(repo, "shared.txt"),
      "base\nengine change\nbystander collision",
    );
    await exec("git", ["add", "."], { cwd: repo });

    const err = await resetKeepTo(repo, preEngine).catch((e) => e);
    expect(err).toBeInstanceOf(ResetKeepRefusedError);
    expect((err as ResetKeepRefusedError).targetSha).toBe(preEngine);
    expect((err as ResetKeepRefusedError).cwd).toBe(repo);

    // Refused: neither the engine's commit nor the bystander's staged edit
    // moved.
    expect(await revParse(repo)).toBe(postEngine);
    const { stdout: status } = await exec(
      "git",
      ["status", "--porcelain"],
      { cwd: repo },
    );
    expect(status).toContain("shared.txt");
    expect(await readFile(join(repo, "shared.txt"), "utf8")).toBe(
      "base\nengine change\nbystander collision",
    );
  });
});

describe("diffNameOnly (spec/loop.md 'Tip verify', per-entry leg)", () => {
  it("returns the cumulative footprint across a multi-commit span, not just the newest commit", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "one.txt"), "1");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "one"], { cwd: repo });
    await writeFile(join(repo, "two.txt"), "2");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "two"], { cwd: repo });
    const tip = await revParse(repo);

    expect((await diffNameOnly(repo, base, tip)).sort()).toEqual([
      "one.txt",
      "two.txt",
    ]);
  });

  it("returns an empty array when the two shas are identical", async () => {
    const sha = await revParse(repo);
    expect(await diffNameOnly(repo, sha, sha)).toEqual([]);
  });
});

describe("cherryPickRange (spec/loop.md 'Tip verify', per-entry leg)", () => {
  it("replays every commit in the range onto the current tip, in order", async () => {
    // A fanout entry's worktree branch shares the main repo's object
    // database (a linked worktree, not a clone) — mirrored here with a
    // sibling branch in the same repo rather than a separate clone, so the
    // range's commits are reachable from `repo` the way they would be from
    // a real worktree branch.
    const base = await revParse(repo);
    await exec("git", ["checkout", "-q", "-b", "entry-branch"], { cwd: repo });
    await writeFile(join(repo, "first.txt"), "first");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "first"], { cwd: repo });
    await writeFile(join(repo, "second.txt"), "second");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "second"], { cwd: repo });
    const head = await revParse(repo);

    await exec("git", ["checkout", "-q", base], { cwd: repo });
    expect(existsSync(join(repo, "first.txt"))).toBe(false);

    await cherryPickRange(repo, base, head);

    expect(existsSync(join(repo, "first.txt"))).toBe(true);
    expect(existsSync(join(repo, "second.txt"))).toBe(true);
    const { stdout: log } = await exec(
      "git",
      ["log", "--format=%s", "-n", "2"],
      { cwd: repo },
    );
    expect(log.trim().split("\n")).toEqual(["second", "first"]);
  });

  it("cherry-picks a single-commit range identically to the plain single-sha form", async () => {
    const base = await revParse(repo);
    await writeFile(join(repo, "solo.txt"), "solo");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "solo"], { cwd: repo });
    const head = await revParse(repo);

    await exec("git", ["checkout", "-q", "-b", "target", base], {
      cwd: repo,
    });
    expect(existsSync(join(repo, "solo.txt"))).toBe(false);

    await cherryPickRange(repo, base, head);

    expect(existsSync(join(repo, "solo.txt"))).toBe(true);
    const { stdout: subject } = await exec(
      "git",
      ["show", "-s", "--format=%s", "HEAD"],
      { cwd: repo },
    );
    expect(subject.trim()).toBe("solo");
  });
});

/**
 * GITDELETEBRANCH-BROAD-SWALLOW — deleteBranch's catch narrows to the
 * expected-benign "branch doesn't exist" case (engineering.md "Loud or
 * nothing"); every other failure — most commonly the branch still checked
 * out in a worktree — rethrows instead of being swallowed.
 */
describe("deleteBranch (GITDELETEBRANCH-BROAD-SWALLOW)", () => {
  it("resolves silently when the branch doesn't exist", async () => {
    await expect(deleteBranch(repo, "no-such-branch")).resolves.toBeUndefined();
  });

  it("rejects when the branch is checked out in a worktree", async () => {
    await exec("git", ["branch", "checked-out-elsewhere"], { cwd: repo });
    const wtPath = join(repo, "wt-checked-out");
    await addWorktree({
      repoRoot: repo,
      path: wtPath,
      branch: "checked-out-elsewhere",
      fromRef: "HEAD",
    });

    await expect(deleteBranch(repo, "checked-out-elsewhere")).rejects.toThrow(
      /checked-out-elsewhere/,
    );
  });
});

/**
 * GIT-DELETEBRANCH-LOCALIZED-STDERR — the "branch doesn't exist" case above
 * used to be detected by matching `/not found/` against git's own English
 * stderr (engine-boundary.md "Told, not inferred": the engine has no
 * business reconstructing a statement from prose it didn't author). A git
 * configured to a non-English locale rephrases that message and the match
 * silently stops firing. deleteBranch now probes `refs/heads/<branch>`
 * structurally (`show-ref --verify --quiet`, keyed off the exit code) so
 * the check holds regardless of what — if anything — lands on stderr. The
 * `node:child_process` mock above fakes exactly that: a `show-ref --verify`
 * miss on this branch's ref, carrying non-English stderr.
 */
describe("deleteBranch — locale-independent (GIT-DELETEBRANCH-LOCALIZED-STDERR)", () => {
  it("no-ops on a missing branch even when git's stderr is not English", async () => {
    await expect(
      deleteBranch(repo, "localized-stderr-missing-branch"),
    ).resolves.toBeUndefined();
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
    // through to §7's fallback rather than clearing on its own. The
    // fallback has namespaced the path since REMOVEWORKTREE-WIN32-PATH-
    // TOTAL-LIMIT; asserting the raw `path` only stayed green because
    // `toNamespacedPath` is identity on POSIX.
    expect(rm).toHaveBeenCalledWith(
      toNamespacedPath(path),
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

// win32 total-path limit (v0.4 §6): removeWorktree's fallback rm/existsSync
// join `path` unwrapped — same shape as the tip-claim/createWorktree family
// (GITTIPCLAIM-WIN32-PATH-TOTAL-LIMIT et al.), on the same worktree-dir
// depth (Dispatcher.ts's fanout worktree base already needed
// toNamespacedPath for this). A worktree this deep pushes the fallback's
// own rm/existsSync calls past win32's ~260-char limit.
describe.runIf(process.platform === "win32")(
  "removeWorktree — win32 total-path limit (REMOVEWORKTREE-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    afterEach(() => {
      vi.mocked(rm).mockClear();
    });

    it("falls back to prune + recursive removal, clearing a populated tree past win32's ~260-char limit, without throwing", async () => {
      const path = join(
        repo,
        "not-a-registered-worktree",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
      );
      expect(path.length).toBeGreaterThan(260);
      // Stand in for a populated node_modules survivor, same fixture shape
      // as the shallow-path §7 fallback test above.
      await mkdir(join(path, "node_modules", "some-pkg"), { recursive: true });
      await writeFile(
        join(path, "node_modules", "some-pkg", "index.js"),
        "module.exports = {};\n",
      );

      vi.mocked(rm).mockClear();
      // `git worktree remove --force` refuses a path it never registered,
      // falling through to the fallback — same trigger as the shallow-path
      // test, just deep enough that the fallback's own unwrapped rm/
      // existsSync would throw ENAMETOOLONG on a real win32 host.
      await expect(removeWorktree(repo, path)).resolves.toBeUndefined();
      expect(existsSync(path)).toBe(false);
    });
  },
);

/**
 * v0.11 §4 — the advisory per-ref tip claim. Keyed under
 * `<git-common-dir>/flume/tip-claims/<ref path>`, mirroring `liveLoopPid`'s
 * (src/job.ts) exclusive-create/pid-liveness/reclaim shape but as a sibling
 * primitive — the tip claim guards a ref, not a state root.
 */
describe("acquireTipClaim / liveTipClaimPid — advisory per-ref tip claim (v0.11 §4)", () => {
  it("creates the claim file under <git-common-dir>/flume/tip-claims/<ref path>, holding this process's pid", async () => {
    const refPath = await resolveRefPath(repo);
    const commonDir = await gitCommonDir(repo);
    const expectedPath = tipClaimPath(commonDir, refPath);

    const claim = await acquireTipClaim(repo, refPath);

    expect(claim.path).toBe(expectedPath);
    expect(existsSync(claim.path)).toBe(true);
    expect(await readFile(claim.path, "utf8")).toBe(String(process.pid));

    claim.release();
  });

  it("refuses with TipClaimHeldError naming the holder pid when a live pid already holds the claim (EEXIST)", async () => {
    const refPath = await resolveRefPath(repo);
    const first = await acquireTipClaim(repo, refPath);

    const attempt = acquireTipClaim(repo, refPath);
    await expect(attempt).rejects.toBeInstanceOf(TipClaimHeldError);
    await expect(attempt).rejects.toThrow(
      new RegExp(
        `${refPath}.*pid ${process.pid}`.replace(/[/\\]/g, "\\$&"),
      ),
    );

    // The refused attempt never disturbed the live holder's claim file.
    expect(await readFile(first.path, "utf8")).toBe(String(process.pid));

    first.release();
  });

  it("reclaims silently and retries when the recorded pid is dead, taking over the claim", async () => {
    const refPath = await resolveRefPath(repo);
    const commonDir = await gitCommonDir(repo);
    const claimPath = tipClaimPath(commonDir, refPath);

    // Harvest a genuinely dead pid: spawn a no-op node child and wait for it
    // to exit before planting it as the stale holder.
    const probe = exec(process.execPath, ["-e", ""]);
    const deadPid = probe.child.pid;
    await probe;
    await mkdir(dirname(claimPath), { recursive: true });
    await writeFile(claimPath, String(deadPid));

    const claim = await acquireTipClaim(repo, refPath);

    expect(claim.path).toBe(claimPath);
    // The dead holder's pid was overwritten by this call's own — proof the
    // stale claim was reclaimed rather than refused.
    expect(await readFile(claimPath, "utf8")).toBe(String(process.pid));

    claim.release();
  });

  it("rethrows a non-ENOENT unlink failure during dead-pid reclaim instead of retrying forever (GIT-TIPCLAIM-RECLAIM-UNLINK-NARROW-ENOENT)", async () => {
    const refPath = await resolveRefPath(repo);
    const commonDir = await gitCommonDir(repo);
    const claimPath = tipClaimPath(commonDir, refPath);

    // Harvest a genuinely dead pid, same setup as the reclaim test above, so
    // the EEXIST branch takes the reclaim path rather than refusing outright.
    const probe = exec(process.execPath, ["-e", ""]);
    const deadPid = probe.child.pid;
    await probe;
    await mkdir(dirname(claimPath), { recursive: true });
    await writeFile(claimPath, String(deadPid));

    const unlinkErr = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(unlink).mockImplementationOnce(() => Promise.reject(unlinkErr));

    await expect(acquireTipClaim(repo, refPath)).rejects.toBe(unlinkErr);

    // The stale claim file was never cleared — the rejection came from the
    // unlink itself, not a retried create failing on some other path.
    expect(await readFile(claimPath, "utf8")).toBe(String(deadPid));
  });

  it("release removes the claim file", async () => {
    const refPath = await resolveRefPath(repo);
    const claim = await acquireTipClaim(repo, refPath);
    expect(existsSync(claim.path)).toBe(true);

    claim.release();

    expect(existsSync(claim.path)).toBe(false);
  });
});

// win32 lane (v0.4 §6): the core.longpaths pin only exists on Windows
// hosts — assert it where it can actually run. Mirrors tests/job.test.ts's
// §5a coverage of job.ts's baseline pin; this is the shared helper both
// job.ts and Dispatcher's createWorktree now call.
describe.runIf(process.platform === "win32")(
  "pinLongPaths (v0.4 §6)",
  () => {
    it("pins core.longpaths repo-locally, idempotently", async () => {
      await pinLongPaths(repo);
      const { stdout } = await exec(
        "git",
        ["config", "--local", "--get", "core.longpaths"],
        { cwd: repo },
      );
      expect(stdout.trim()).toBe("true");

      // Re-run: pin idempotent, no error on repeat.
      await pinLongPaths(repo);
      const { stdout: again } = await exec(
        "git",
        ["config", "--local", "--get", "core.longpaths"],
        { cwd: repo },
      );
      expect(again.trim()).toBe("true");
    });

    it("skips the write when already true, even when .git/config is unwritable (PINLONGPATHS-CHECKTHENSKIP)", async () => {
      await pinLongPaths(repo);

      const commonDir = await gitCommonDir(repo);
      const configPath = join(commonDir, "config");
      await chmod(configPath, 0o444);
      try {
        // Pre-fix, pinLongPaths always re-issues `git config
        // core.longpaths true` — a write that throws EACCES against a
        // read-only .git/config even though the value is already correct.
        // Post-fix, the check-then-skip reads the value is already "true"
        // and never attempts the write.
        await expect(pinLongPaths(repo)).resolves.toBeUndefined();

        const { stdout } = await exec(
          "git",
          ["config", "--local", "--get", "core.longpaths"],
          { cwd: repo },
        );
        expect(stdout.trim()).toBe("true");
      } finally {
        await chmod(configPath, 0o644);
      }
    });
  },
);

// win32 total-path limit (v0.4 §6): tipClaimPath mirrors refPath as nested
// directories under commonDir/flume/tip-claims — the same shape
// createWorktree's own branch naming (flume/<namespace>/slugify(entry.tag))
// already needed toNamespacedPath for (WORKTREE-WIN32-PATH-TOTAL-LIMIT). A
// refPath this deep pushes the claim path past win32's ~260-char limit.
describe.runIf(process.platform === "win32")(
  "acquireTipClaim / liveTipClaimPid / release — win32 total-path limit (GITTIPCLAIM-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    it("round-trips acquire/release when refPath's mirrored directories nest past win32's ~260-char limit", async () => {
      const refPath = [
        "refs",
        "heads",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
      ].join("/");
      const commonDir = await gitCommonDir(repo);
      const claimPath = tipClaimPath(commonDir, refPath);
      expect(claimPath.length).toBeGreaterThan(260);

      const claim = await acquireTipClaim(repo, refPath);
      expect(claim.path).toBe(claimPath);
      expect(await liveTipClaimPid(claimPath)).toBe(process.pid);

      claim.release();
      expect(await liveTipClaimPid(claimPath)).toBeNull();
    });
  },
);
