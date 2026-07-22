/**
 * git — narrow shell wrapper around the subset of git operations the
 * dispatcher needs. We avoid simple-git or isomorphic-git to keep the
 * dependency surface minimal; nine commands is all we use.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await exec("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
}

export async function revParse(cwd: string, ref = "HEAD"): Promise<string> {
  const { stdout } = await run(cwd, ["rev-parse", ref]);
  return stdout;
}

export async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout;
}

/** Soft reset by N commits. Working tree preserved; index reset. */
export async function softReset(cwd: string, n: number): Promise<void> {
  await run(cwd, ["reset", "--soft", `HEAD~${n}`]);
}

/** Hard reset to a specific SHA. Discards working tree changes. */
export async function hardResetTo(cwd: string, sha: string): Promise<void> {
  await run(cwd, ["reset", "--hard", sha]);
}

/** Drop the most recent commit and its working-tree changes. */
export async function dropLastCommit(cwd: string): Promise<void> {
  await run(cwd, ["reset", "--hard", "HEAD~1"]);
}

export async function addWorktree(opts: {
  repoRoot: string;
  path: string;
  branch: string;
  fromRef: string;
}): Promise<void> {
  await run(opts.repoRoot, [
    "worktree",
    "add",
    "-B",
    opts.branch,
    opts.path,
    opts.fromRef,
  ]);
}

export async function removeWorktree(
  repoRoot: string,
  path: string,
): Promise<void> {
  await run(repoRoot, ["worktree", "remove", "--force", path]);
}

/**
 * Prune stale entries from `.git/worktrees/` — i.e. metadata for worktrees
 * whose working directory has vanished. Idempotent. Run before any
 * worktree-add to recover from prior crashes or partial fanout failures
 * that left git's internal metadata desynced from `.flume/worktrees/`.
 *
 * Without this, a half-broken `.git/worktrees/<old-slug>/` makes EVERY
 * subsequent `git worktree add` fail — even for a totally different slug —
 * because git scans all worktree metadata during validation.
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await run(repoRoot, ["worktree", "prune"]);
}

export async function deleteBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  try {
    await run(repoRoot, ["branch", "-D", branch]);
  } catch {
    // Branch may not exist; harmless.
  }
}

/**
 * File paths touched by a single commit. Used to record an entry's *actual*
 * footprint when its merge fails, so the partitioner can learn what the
 * declared `files` under-stated.
 */
export async function showNameOnly(
  repoRoot: string,
  sha: string,
): Promise<string[]> {
  const { stdout } = await run(repoRoot, [
    "show",
    "--name-only",
    "--format=",
    sha,
  ]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function cherryPick(repoRoot: string, sha: string): Promise<void> {
  await run(repoRoot, ["cherry-pick", sha]);
}

/**
 * Abort an in-progress cherry-pick, restoring the working tree to its
 * pre-cherry-pick state. Idempotent: errors when no cherry-pick is in
 * progress are swallowed.
 */
export async function cherryPickAbort(repoRoot: string): Promise<void> {
  try {
    await run(repoRoot, ["cherry-pick", "--abort"]);
  } catch {
    // No cherry-pick in progress, or already aborted — nothing to clean up.
  }
}

export async function commitAll(opts: {
  cwd: string;
  message: string;
  /** Allow an empty commit; used by harness chore commits when nothing changed. */
  allowEmpty?: boolean;
}): Promise<string> {
  await run(opts.cwd, ["add", "-A"]);
  const args = ["commit", "-m", opts.message];
  if (opts.allowEmpty) args.push("--allow-empty");
  await run(opts.cwd, args);
  return revParse(opts.cwd);
}

/** Stage a specific set of paths and commit. Scoped alternative to commitAll. */
export async function commitPaths(opts: {
  cwd: string;
  message: string;
  paths: string[];
}): Promise<string> {
  if (opts.paths.length === 0) {
    throw new Error("commitPaths requires at least one path");
  }
  await run(opts.cwd, ["add", "--", ...opts.paths]);
  await run(opts.cwd, ["commit", "-m", opts.message]);
  return revParse(opts.cwd);
}

/** True iff the working tree has uncommitted changes (staged or unstaged). */
export async function isDirty(cwd: string): Promise<boolean> {
  const { stdout } = await run(cwd, ["status", "--porcelain"]);
  return stdout.length > 0;
}
