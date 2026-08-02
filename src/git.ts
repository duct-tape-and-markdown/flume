/**
 * git — narrow shell wrapper around the subset of git operations the
 * dispatcher needs. We avoid simple-git or isomorphic-git to keep the
 * dependency surface minimal; eight commands is all we use.
 */

import { execFile } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * §7 (RELEASE-v0.6.2): bounded retries for the recursive-removal fallback
 * below — the EBUSY/ENOTEMPTY class a just-installed, still-settling
 * node_modules produces on win32 (the v0.6.1 dogfood symptom: three build
 * waves, three `Directory not empty` failures, hand sweep).
 */
const FALLBACK_REMOVE_MAX_RETRIES = 5;
const FALLBACK_REMOVE_RETRY_DELAY_MS = 200;

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

/** Soft reset by N commits. Working tree preserved; index reset. */
export async function softReset(cwd: string, n: number): Promise<void> {
  await run(cwd, ["reset", "--soft", `HEAD~${n}`]);
}

/** Hard reset to a specific SHA. Discards working tree changes. */
export async function hardResetTo(cwd: string, sha: string): Promise<void> {
  await run(cwd, ["reset", "--hard", sha]);
}

/**
 * Drop the most recent commit and its working-tree changes.
 *
 * `expectedSha` names the commit this call itself created — the caller's
 * own `postHead`, still in scope from the commit it just made. Refuses
 * (§17, RELEASE-v0.7) rather than reset when the current tip has moved
 * on: two supervisors on one tree means a stale caller could otherwise
 * drop a commit it never created.
 */
export async function dropLastCommit(
  cwd: string,
  expectedSha: string,
): Promise<void> {
  const currentTip = await revParse(cwd);
  if (currentTip !== expectedSha) {
    throw new Error(
      `dropLastCommit refused: current tip ${currentTip} does not match ` +
        `expected ${expectedSha} — this call did not create the commit at ` +
        `the current tip, refusing to reset --hard`,
    );
  }
  await run(cwd, ["reset", "--hard", "HEAD~1"]);
}

/**
 * win32 MAX_PATH guard (v0.4 §6): repo-locally pin `core.longpaths` before
 * any operation that nests paths deep enough to exceed it — a job dir
 * (`.flume/jobs/<name>/...`) or a fanout worktree (nested at least as deep
 * as the job dir it was cloned for). No-op off win32; idempotent (`git
 * config` overwrites the same key without erroring on repeat calls).
 */
export async function pinLongPaths(repoRoot: string): Promise<void> {
  if (process.platform !== "win32") return;
  await run(repoRoot, ["config", "core.longpaths", "true"]);
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

/**
 * Remove a worktree, falling back past a bare `git worktree remove --force`
 * failure (§7, RELEASE-v0.6.2). On win32, a just-installed pnpm
 * `node_modules` commonly still has handles open when teardown runs,
 * turning `--force` into `Directory not empty` instead of a clean removal.
 *
 * Fallback: `worktree prune` (drops git's metadata once the directory is
 * gone — a no-op here, since the directory still exists at this point, but
 * cheap and correct to attempt) then a bounded-retry recursive filesystem
 * removal, which is exactly what `fs.rm`'s `maxRetries`/`retryDelay` exist
 * for (the EBUSY/locked-handle class). If the directory still survives
 * after retries, this throws with the surviving path so the caller can
 * aggregate — reporting per-worktree here would spam a wave-level failure
 * once per surviving worktree.
 */
export async function removeWorktree(
  repoRoot: string,
  path: string,
): Promise<void> {
  try {
    await run(repoRoot, ["worktree", "remove", "--force", path]);
    return;
  } catch {
    // Bare removal failed (e.g. win32 `Directory not empty`) — fall
    // through to the recursive-removal fallback below.
  }
  await pruneWorktrees(repoRoot);
  await rm(toNamespacedPath(path), {
    recursive: true,
    force: true,
    maxRetries: FALLBACK_REMOVE_MAX_RETRIES,
    retryDelay: FALLBACK_REMOVE_RETRY_DELAY_MS,
  });
  if (existsSync(toNamespacedPath(path))) {
    throw new Error(`worktree directory survived removal fallback: ${path}`);
  }
  // The directory is gone now — prune the now-stale `.git/worktrees/` entry
  // `--force` alone left behind.
  await pruneWorktrees(repoRoot);
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

/**
 * Loud or nothing (engineering.md): only the expected-benign "branch
 * doesn't exist" case is swallowed — git's own wording for it (`error:
 * branch '<name>' not found.`). Any other failure (most commonly the
 * branch still checked out in a worktree that survived removal) rethrows
 * so the caller can surface it rather than losing it silently.
 */
export async function deleteBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  try {
    await run(repoRoot, ["branch", "-D", branch]);
  } catch (err) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: string })
      .stderr;
    if (typeof stderr === "string" && /not found/.test(stderr)) return;
    throw err;
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

/** Stage a specific set of paths and commit. */
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

/**
 * Resolve the shared git-common-dir for `cwd` (`git rev-parse
 * --git-common-dir`) — the same absolute path from every linked worktree, so
 * state written under it is visible across every worktree of one repository
 * (RELEASE-v0.11 §4, following the `git-lfs`/`sequencer` precedent for
 * shared, untracked tool state under `.git/`).
 */
export async function gitCommonDir(cwd: string): Promise<string> {
  const { stdout } = await run(cwd, ["rev-parse", "--git-common-dir"]);
  return resolve(cwd, stdout);
}

/**
 * The ref HEAD resolves to (e.g. `refs/heads/main`), or `null` when HEAD is
 * detached (or `cwd` is not a git repo at all) — `git symbolic-ref` exits
 * non-zero rather than naming a ref in either case.
 */
export async function currentRefPath(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
    return stdout || null;
  } catch {
    return null;
  }
}

/**
 * Where the tip claim for `refPath` lives under a git-common-dir
 * (RELEASE-v0.11 §4): the ref path mirrored as directories, e.g.
 * `<commonDir>/flume/tip-claims/refs/heads/main`.
 */
export function tipClaimPath(commonDir: string, refPath: string): string {
  return join(commonDir, "flume", "tip-claims", ...refPath.split("/"));
}

/**
 * The pid recorded at a tip-claim path, when it names a live process —
 * `null` for no claim file, an unparsable one, or a dead/not-ours pid
 * (stale; callers reclaim silently). Same liveness probe as the loop lock
 * (`liveLoopPid`, src/job.ts) — a sibling primitive rather than a shared call
 * site, since the two guard different resources (a ref vs. a state root)
 * under different keying.
 */
export async function liveTipClaimPid(claimPath: string): Promise<number | null> {
  if (!existsSync(toNamespacedPath(claimPath))) return null;
  const pid = Number(
    (await readFile(toNamespacedPath(claimPath), "utf8")).trim(),
  );
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/**
 * Thrown by {@link acquireTipClaim} when a live process already holds the
 * claim — the operational-refusal class, same as the loop lock's refusal.
 */
export class TipClaimHeldError extends Error {
  constructor(
    public readonly refPath: string,
    public readonly holderPid: number,
    public readonly claimPath: string,
  ) {
    super(`tip ${refPath} claimed by pid ${holderPid} (${claimPath})`);
  }
}

export interface TipClaim {
  path: string;
  /** Remove the claim file. Idempotent — safe to call from an exit handler. */
  release: () => void;
}

/**
 * Acquire the advisory per-ref tip claim (RELEASE-v0.11 §4): one flume
 * writer per tip. Exclusive-create (`wx`) the claim file at
 * `<git-common-dir>/flume/tip-claims/<refPath>`. On `EEXIST`, probe the
 * recorded pid with the same liveness check as the loop lock: live → refuse
 * ({@link TipClaimHeldError}, naming the holder); dead → reclaim (unlink,
 * retry the exclusive create).
 */
export async function acquireTipClaim(
  cwd: string,
  refPath: string,
): Promise<TipClaim> {
  const commonDir = await gitCommonDir(cwd);
  const claimPath = tipClaimPath(commonDir, refPath);
  await mkdir(toNamespacedPath(dirname(claimPath)), { recursive: true });
  for (;;) {
    try {
      await writeFile(toNamespacedPath(claimPath), String(process.pid), {
        flag: "wx",
      });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = await liveTipClaimPid(claimPath);
      if (holder !== null) {
        throw new TipClaimHeldError(refPath, holder, claimPath);
      }
      // Dead pid — reclaim: unlink and retry the exclusive create. A
      // concurrent reclaimer may win the unlink race first; the retried
      // create's own possible EEXIST re-probes rather than assuming this
      // call won.
      try {
        await unlink(toNamespacedPath(claimPath));
      } catch {
        // Already gone — another reclaimer won the race; retry the create.
      }
    }
  }
  return {
    path: claimPath,
    release: () => {
      try {
        unlinkSync(toNamespacedPath(claimPath));
      } catch {
        // already gone
      }
    },
  };
}
