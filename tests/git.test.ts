import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, toNamespacedPath } from "node:path";
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
// `execArgsLog` records every `(file, args, options)` triple git.ts's own
// `exec = promisify(execFile)` actually issues — captured inside the custom
// implementation because `promisify` resolves `execFile[promisify.custom]`
// once at git.ts's module-load time and calls that directly, bypassing the
// wrapped `execFileMock` vi.fn body entirely; a spy attached to `execFileMock`
// (or reassigned onto the custom symbol after import) never sees these
// calls. Read via `execArgsLogSince` below — the cherryPickAbort tests are
// the one place a call log, not just a passthrough, is needed.
const execArgsLog: unknown[][] = [];

// The argv of every call this mock actually answered with the localized
// rejection. The injection is keyed on an argv position, so a caller-side
// argv change would stop it firing while the case stayed green over the real
// git's exit-1 English miss — the locale test reads this to pin that the
// rejection it is about reached `deleteBranch` at all.
const injectedRejections: string[][] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify: nodePromisify } = await import("node:util");
  const customPromisify = (
    actual.execFile as unknown as Record<symbol, unknown>
  )[nodePromisify.custom] as (
    ...args: unknown[]
  ) => Promise<{ stdout: string; stderr: string }>;
  const execFileMock = vi.fn(
    actual.execFile,
  ) as unknown as typeof actual.execFile;
  Object.defineProperty(execFileMock, nodePromisify.custom, {
    configurable: true,
    value: (...callArgs: unknown[]) => {
      execArgsLog.push(callArgs);
      const gitArgs = callArgs[1] as string[] | undefined;
      const targetsMissingBranch =
        (gitArgs?.[0] === "show-ref" &&
          gitArgs[3] === "refs/heads/localized-stderr-missing-branch") ||
        (gitArgs?.[0] === "branch" &&
          gitArgs[1] === "-D" &&
          gitArgs[2] === "localized-stderr-missing-branch");
      if (targetsMissingBranch) {
        injectedRejections.push(gitArgs ?? []);
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

/** Every logged `(file, args, options)` call since `sinceIndex`. */
function execArgsLogSince(sinceIndex: number): unknown[][] {
  return execArgsLog.slice(sinceIndex);
}

import {
  acquireTipClaim,
  addWorktree,
  checkpointBystanderState,
  cherryPickAbort,
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
  showNameOnly,
  softResetTo,
  statusRecords,
  tipClaimPath,
  trackedModifications,
  TipClaimHeldError,
} from "../src/git.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";

import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

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
    const missing = join(
      await mkdtemp(join(tmpdir(), "flume-missing-")),
      "gone",
    );
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
    const files = changed
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(files).toEqual(["tracked.txt"]);

    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(status).toContain("ignored.txt");
  });

  // `commitPaths` is `async`, so its guard throw can only surface as a
  // rejection — a synchronous throw is not a shape this subject can take.
  it("rejects when no paths are supplied", async () => {
    await expect(
      commitPaths({ cwd: repo, message: "noop", paths: [] }),
    ).rejects.toThrow(/at least one path/);
  });
});

// A filename may not contain `*` on win32 — the Win32 path layer refuses the
// create call, so the sibling pair this case needs cannot exist there.
//
// Deliberately top-level rather than inside the describe above: this title is
// the queue entry's own `tests[]` line, matched on the full name.
it.runIf(process.platform !== "win32")(
  "commitPaths stages only its given path when a sibling name glob-matches it",
  async () => {
    // Two tracked files whose names glob-match one another, both dirty. The
    // commit leg takes no pathspec of its own, so anything the staging leg
    // over-matches rides into the commit whole.
    await writeFile(join(repo, "a*.txt"), "one\n");
    await writeFile(join(repo, "ab.txt"), "two\n");
    await exec("git", ["add", "--all"], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "both names"], { cwd: repo });
    await writeFile(join(repo, "a*.txt"), "one edited\n");
    await writeFile(join(repo, "ab.txt"), "two edited\n");

    // Vacuity pin: read as a pattern, the given path really does select the
    // sibling as well as itself — which is what makes "only its given path" a
    // claim about this repo rather than about a name with no sibling.
    const { stdout: asPattern } = await exec(
      "git",
      ["ls-files", "--", "a*.txt"],
      { cwd: repo },
    );
    expect(lines(asPattern)).toEqual(["a*.txt", "ab.txt"]);

    await commitPaths({ cwd: repo, message: "ship one", paths: ["a*.txt"] });

    const { stdout: changed } = await exec(
      "git",
      ["show", "--name-only", "--pretty=format:", "HEAD"],
      { cwd: repo },
    );
    expect(lines(changed)).toEqual(["a*.txt"]);

    // The sibling's edit is untouched: neither staged nor committed.
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(lines(status)).toEqual(["M ab.txt"]);
  },
);

/** Non-empty, trimmed lines of a git listing. */
function lines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

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

  it("rejects on an unresolvable ref rather than reading it as an absent path — the two answers are never confused", async () => {
    await expect(
      readFileAtRef(repo, "refs/heads/no-such-branch", "anything.txt"),
    ).rejects.toThrow();
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

// A filename may not contain `:` on win32 — the Win32 path layer refuses the
// create call, so neither this fixture nor a `git checkout` of it can exist
// there.
//
// Deliberately top-level rather than inside the describe above: this title is
// the queue entry's own `tests[]` line, matched on the full name.
it.runIf(process.platform !== "win32")(
  "readFileAtRef reads a committed path whose name begins with a colon",
  async () => {
    await writeFile(join(repo, ":leading.txt"), "colon content\n");
    await exec("git", ["add", "--all"], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "add colon-leading path"], {
      cwd: repo,
    });

    // Vacuity pin: the path really is at this ref (`<ref>:<path>` resolves
    // it, and git's own listing names it), while the *default* pathspec parse
    // of that same name lists nothing — which is what makes the probe's
    // `null` a substituted verdict rather than an honest absence.
    await expect(
      exec("git", ["cat-file", "-e", "HEAD::leading.txt"], { cwd: repo }),
    ).resolves.toBeDefined();
    const { stdout: defaultParse } = await exec(
      "git",
      ["ls-tree", "--name-only", "HEAD", "--", ":leading.txt"],
      { cwd: repo },
    );
    expect(defaultParse.trim()).toBe("");

    expect(await readFileAtRef(repo, "HEAD", ":leading.txt")).toBe(
      "colon content\n",
    );
  },
);

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
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
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
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
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

/**
 * Both `--name-only` readers over the one input that tells the quoted form
 * from the committed one: git's default output wraps a non-ASCII path in
 * double quotes with its bytes octal-escaped, so a reader taking that form
 * hands every consumer a path that was never committed — the fence glob
 * misses it, and it lands in `observedFiles` under a name no partition can
 * key on (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * The space-bearing path rides along in the same commit for the separator
 * half of the claim: git leaves it *un*quoted (measured, 2.43), so only the
 * `-z` field boundary keeps it whole and un-trimmed.
 */
async function commitNonAsciiPath(): Promise<{ base: string; sha: string }> {
  const base = await revParse(repo);
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "café.ts"), "export const x = 1;\n");
  await writeFile(join(repo, "src", "two words.ts"), "export const y = 2;\n");
  await exec("git", ["add", "."], { cwd: repo });
  await exec("git", ["commit", "-q", "-m", "non-ascii"], { cwd: repo });
  return { base, sha: await revParse(repo) };
}

it("diffNameOnly returns a committed non-ASCII path as git spelled it", async () => {
  const { base, sha } = await commitNonAsciiPath();

  expect((await diffNameOnly(repo, base, sha)).sort()).toEqual([
    "src/café.ts",
    "src/two words.ts",
  ]);
});

it("showNameOnly returns a committed non-ASCII path as git spelled it", async () => {
  const { sha } = await commitNonAsciiPath();

  expect((await showNameOnly(repo, sha)).sort()).toEqual([
    "src/café.ts",
    "src/two words.ts",
  ]);
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
 * cherryPickAbort (spec/loop.md "Crash equals stop", "An abort is issued
 * only against a sequence that started"): `--abort` runs iff
 * `CHERRY_PICK_HEAD`/`sequencer/` state is actually on disk — never blind,
 * since a blind abort on a checkout that never started a sequence would
 * reset an operator's index/working tree for no reason. Asserted off
 * `execArgsLogSince` (top of file) — the exact `(file, args, options)`
 * triples git.ts's own `exec` issued — rather than a per-test spy, since
 * `promisify(execFile)` resolves `[promisify.custom]` once at git.ts's
 * module-load time and calls that directly, bypassing any wrapper attached
 * after import.
 */
describe("cherryPickAbort (spec/loop.md 'Crash equals stop')", () => {
  function abortCalls(calls: unknown[][]): unknown[][] {
    return calls.filter((c) => {
      const args = c[1] as string[] | undefined;
      return args?.[0] === "cherry-pick" && args?.[1] === "--abort";
    });
  }

  /** The relPath of every `rev-parse --git-path <relPath>` in `calls`. */
  function gitPathProbes(calls: unknown[][]): string[] {
    return calls.flatMap((c) => {
      const args = c[1] as string[] | undefined;
      return args?.[0] === "rev-parse" && args[1] === "--git-path" && args[2]
        ? [args[2]]
        : [];
    });
  }

  it("cherryPickAbort probes for sequencer state and issues no --abort when none is present", async () => {
    // A totally untouched checkout — no cherry-pick of any kind was ever
    // attempted, so neither CHERRY_PICK_HEAD nor sequencer/ exists.
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
    expect(existsSync(join(repo, ".git", "sequencer"))).toBe(false);

    const since = execArgsLog.length;
    await expect(cherryPickAbort(repo)).resolves.toBeUndefined();
    const calls = execArgsLogSince(since);

    // Vacuity pin before the verdict: "zero `--abort` calls" is a claim
    // about a log that caught this call's git commands, and the
    // `promisify.custom` interception it rides on is fragile (top of file).
    // The guard reads the sequencer state through exactly two `rev-parse
    // --git-path` probes, so a live log carries both; an interception that
    // silently stopped recording leaves an empty slice over which the
    // assertion below is green for the wrong reason. The probes are also
    // why the verdict is "no `--abort`", not "no git command".
    expect(gitPathProbes(calls).sort()).toEqual([
      "CHERRY_PICK_HEAD",
      "sequencer",
    ]);
    expect(abortCalls(calls)).toHaveLength(0);
  });

  it("issues --abort when CHERRY_PICK_HEAD/sequencer state is present", async () => {
    const base = await revParse(repo);
    await exec("git", ["checkout", "-q", "-b", "other"], { cwd: repo });
    await writeFile(join(repo, "file.txt"), "from-other\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "other-change"], { cwd: repo });
    const head = await revParse(repo);

    await exec("git", ["checkout", "-q", base], { cwd: repo });
    await writeFile(join(repo, "file.txt"), "from-primary\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "primary-change"], {
      cwd: repo,
    });

    // A real content conflict — git writes CHERRY_PICK_HEAD once it
    // actually starts applying the conflicting commit, unlike a pre-flight
    // refusal that never gets that far.
    await expect(
      exec("git", ["cherry-pick", `${base}..${head}`], { cwd: repo }),
    ).rejects.toThrow();
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(true);

    const since = execArgsLog.length;
    await cherryPickAbort(repo);
    expect(abortCalls(execArgsLogSince(since)).length).toBeGreaterThan(0);

    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(status.trim()).toBe("");
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe(
      "from-primary\n",
    );
  });

  // `existsSync` collapsed every stat failure to `false`, so a sequencer
  // path that is on disk but unstattable read as "no sequence started" and
  // the abort spec/loop.md "Crash equals stop" owes an interrupted pick was
  // skipped silently, over a checkout still holding the pick's state. The
  // probe now splits ENOENT from the rest (`existsLoud`, src/fsProbe.ts).
  it("cherryPickAbort throws when a sequencer-state path is present but unstattable", async () => {
    const headPath = join(repo, ".git", "CHERRY_PICK_HEAD");
    // Vacuity guard: the fixture below is the only reason this path is
    // present, so the checkout starts with no real sequencer state at all.
    expect(existsSync(headPath)).toBe(false);
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink(basename(headPath), headPath);

    const since = execArgsLog.length;
    await expect(cherryPickAbort(repo)).rejects.toThrow(/ELOOP/);
    // The refusal landed at the state probe, not at a blind `--abort` that
    // would have reset the operator's index and working tree.
    expect(abortCalls(execArgsLogSince(since))).toHaveLength(0);
  });
});

describe("checkpointBystanderState (spec/loop.md 'Crash equals stop', 'Staged bystander state is checkpointed before a pick range begins')", () => {
  it("returns undefined and touches nothing when the checkout is clean", async () => {
    await expect(checkpointBystanderState(repo)).resolves.toBeUndefined();
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(status.trim()).toBe("");
  });

  it("captures staged content as a recoverable dangling commit, without resetting anything", async () => {
    await writeFile(join(repo, "staged.txt"), "staged content\n");
    await exec("git", ["add", "staged.txt"], { cwd: repo });
    await writeFile(join(repo, ".seed"), "unstaged edit\n");

    const shaOrUndefined = await checkpointBystanderState(repo);
    expect(shaOrUndefined).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/));
    const sha = shaOrUndefined as string;

    // Nothing was reset — the staged/unstaged content is exactly where the
    // caller left it, and the checkpoint itself moved no ref.
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: repo,
    });
    expect(status).toContain("staged.txt");
    expect(status).toContain(".seed");
    expect(await readFile(join(repo, "staged.txt"), "utf8")).toBe(
      "staged content\n",
    );

    // Recoverable from the sha alone.
    const { stdout: recovered } = await exec(
      "git",
      ["show", `${sha}:staged.txt`],
      { cwd: repo },
    );
    expect(recovered).toBe("staged content\n");
    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: repo,
    });
    // A dangling commit — no branch or ref points at it.
    const { stdout: branchAtSha } = await exec(
      "git",
      ["branch", "--contains", sha],
      { cwd: repo },
    );
    expect(branchAtSha.trim()).toBe("");
    expect(head.trim()).not.toBe(sha);
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
 *
 * Deliberately top-level rather than in a describe: this title is the queue
 * entry's own `pins[]` line, matched on the full name.
 */
it("deleteBranch no-ops on a missing branch whose git rejection carries non-English stderr", async () => {
  const since = injectedRejections.length;

  await expect(
    deleteBranch(repo, "localized-stderr-missing-branch"),
  ).resolves.toBeUndefined();

  // Vacuity pin: the resolve above says nothing about locale independence
  // unless the localized rejection actually reached `deleteBranch`. Should
  // the probe's argv drift out from under the mock's match, the real git
  // runs, misses the same ref, and exits 1 with *English* stderr — the
  // resolve holds and this case would keep passing over a subject it no
  // longer exercises.
  const injected = injectedRejections.slice(since);
  expect(injected.map((argv) => argv[0])).toContain("show-ref");
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

  // The survival check's own stat: `existsSync` read an unstattable
  // survivor as gone, so the fallback reported a clean removal and pruned
  // git's metadata for a directory still standing (`.claude/rules/
  // engineering.md`, "Loud or nothing").
  it("removeWorktree throws when the post-removal survival check cannot stat the path", async () => {
    const path = join(repo, "not-a-registered-worktree-unstattable");
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink(basename(path), path);

    // Same stand-in as the survivor test above: a recursive removal that
    // resolves without clearing the path, so the survival check is what
    // this test actually exercises.
    vi.mocked(rm).mockImplementationOnce(async () => {});

    await expect(removeWorktree(repo, path)).rejects.toThrow(/ELOOP/);
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
      new RegExp(`${refPath}.*pid ${process.pid}`.replace(/[/\\]/g, "\\$&")),
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

  // The claim file's own stat: `existsSync` read an unstattable claim as no
  // claim at all, and `acquireTipClaim`'s EEXIST branch then took the
  // dead-pid path and reclaimed a tip a live writer may still hold — the
  // one outcome the refusal exists to rule out (`.claude/rules/
  // engineering.md`, "Loud or nothing").
  it("liveTipClaimPid throws when the claim path is present but unstattable", async () => {
    const refPath = await resolveRefPath(repo);
    const claimPath = tipClaimPath(await gitCommonDir(repo), refPath);
    await mkdir(dirname(claimPath), { recursive: true });
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink(basename(claimPath), claimPath);

    await expect(liveTipClaimPid(claimPath)).rejects.toThrow(/ELOOP/);
  });

  it("acquireTipClaim refuses an unstattable claim rather than reclaiming the tip", async () => {
    const refPath = await resolveRefPath(repo);
    const claimPath = tipClaimPath(await gitCommonDir(repo), refPath);
    await mkdir(dirname(claimPath), { recursive: true });
    await symlink(basename(claimPath), claimPath);

    // The exclusive create sees the symlink and fails EEXIST, so this is the
    // reclaim branch — the higher-stakes half of the same probe.
    await expect(acquireTipClaim(repo, refPath)).rejects.toThrow(/ELOOP/);
    // The claim was never unlinked on the way out: the refusal beat the
    // reclaim rather than following it.
    expect(existsSync(dirname(claimPath))).toBe(true);
    await expect(readFile(claimPath, "utf8")).rejects.toThrow(/ELOOP/);
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
describe.runIf(process.platform === "win32")("pinLongPaths (v0.4 §6)", () => {
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
});

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

/**
 * The decode a chain reads, driven through `buildFlumeApi` rather than the
 * module export: the claim is that the fact reaches the API surface a gate
 * is handed, not merely that a function in `src/` exists
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 */
describe("buildFlumeApi().git.statusRecords", () => {
  const api = (): ReturnType<typeof buildFlumeApi> =>
    buildFlumeApi({ repoRoot: repo, configDir: repo, flumeDir: repo });

  it("api.git reports a status record's code and path with a rename's origin field consumed", async () => {
    const git = api().git;
    expect(git.statusRecords).toBe(statusRecords);

    await writeFile(join(repo, "old name.ts"), "content\n");
    await writeFile(join(repo, "edited.ts"), "one\n");
    await exec("git", ["add", "--", "old name.ts", "edited.ts"], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed rename source"], {
      cwd: repo,
    });
    await exec("git", ["mv", "old name.ts", "new name.ts"], { cwd: repo });
    await writeFile(join(repo, "edited.ts"), "two\n");
    await writeFile(join(repo, "scratch.log"), "untracked\n");

    const records = await git.statusRecords(repo);

    // Three records, not four: `-z` spends a second NUL field on the path a
    // rename came from, and that field carries no status code — read as a
    // record of its own it would arrive as a path with its first three bytes
    // eaten, under a code sliced out of the middle of a filename.
    expect(records).toEqual([
      { code: " M", path: "edited.ts" },
      { code: "R ", path: "new name.ts" },
      { code: "??", path: "scratch.log" },
    ]);
    // Both bytes verbatim, so staged and unstaged stay distinguishable and a
    // caller can tell untracked from tracked without a second git call.
    expect(records.map((r) => r.code.trim())).toEqual(["M", "R", "??"]);
  });

  it("drops no record the porcelain listing carries, so trackedModifications is its filter", async () => {
    await writeFile(join(repo, "tracked.ts"), "one\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed"], { cwd: repo });
    await writeFile(join(repo, "tracked.ts"), "edited\n");
    await writeFile(join(repo, "scratch.log"), "untracked\n");

    const records = await api().git.statusRecords(repo);
    // Vacuity pin: an empty listing would satisfy the filter claim below.
    expect(records.length).toBe(2);
    expect(await trackedModifications(repo)).toEqual(
      records.filter((r) => r.code !== "??").map((r) => r.path),
    );
  });
});

describe("trackedModifications", () => {
  it("names a staged rename by the path on disk and consumes the origin field", async () => {
    await writeFile(join(repo, "old name.ts"), "content\n");
    await exec("git", ["add", "--", "old name.ts"], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed rename source"], {
      cwd: repo,
    });
    await exec("git", ["mv", "old name.ts", "new name.ts"], { cwd: repo });

    // One path, not two: `-z` spends a second NUL field on the origin, which
    // carries no status code — read as a record of its own it would arrive
    // as a path with its first three bytes eaten.
    expect(await trackedModifications(repo)).toEqual(["new name.ts"]);
  });

  it("reports staged and unstaged tracked edits and drops untracked files", async () => {
    await writeFile(join(repo, "tracked.ts"), "one\n");
    await writeFile(join(repo, "staged.ts"), "two\n");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed two tracked files"], {
      cwd: repo,
    });

    await writeFile(join(repo, "tracked.ts"), "edited unstaged\n");
    await writeFile(join(repo, "staged.ts"), "edited staged\n");
    await exec("git", ["add", "--", "staged.ts"], { cwd: repo });
    await writeFile(join(repo, "scratch.log"), "untracked\n");

    expect(await trackedModifications(repo)).toEqual([
      "staged.ts",
      "tracked.ts",
    ]);
  });

  it("returns an empty list on a clean tree", async () => {
    expect(await trackedModifications(repo)).toEqual([]);
  });
});
