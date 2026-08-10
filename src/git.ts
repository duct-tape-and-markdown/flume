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

/**
 * Count of commits reachable from `to` but not from `from` (`git rev-list
 * --count from..to`) — the depth a tip-verify revert must soft-reset to
 * undo everything a tick produced, not just its newest commit.
 */
export async function commitsSince(
  cwd: string,
  from: string,
  to: string,
): Promise<number> {
  const { stdout } = await run(cwd, ["rev-list", "--count", `${from}..${to}`]);
  return Number(stdout);
}

/** Hard reset to a specific SHA. Discards working tree changes. */
export async function hardResetTo(cwd: string, sha: string): Promise<void> {
  await run(cwd, ["reset", "--hard", sha]);
}

/**
 * Soft reset directly to a specific sha, rather than a commit count back
 * from HEAD. Used by the per-entry tip-verify leg (spec/loop.md "Tip
 * verify"): unlike the trunk leg's `softReset`, the target here is the
 * recorded base itself, which on a refusal is not necessarily an ancestor of
 * the current tip (that is exactly what the ancestry check failed on) — so
 * counting commits back from HEAD does not apply. `reset --soft` accepts any
 * commit-ish regardless of ancestry: it moves the branch ref and index,
 * leaving the working tree (and therefore the abandoned commits' content) in
 * place as uncommitted state.
 */
export async function softResetTo(cwd: string, sha: string): Promise<void> {
  await run(cwd, ["reset", "--soft", sha]);
}

/**
 * Files touched across a commit range (`git diff --name-only from to`) — the
 * cumulative footprint of a per-entry fanout span (spec/loop.md "Tip
 * verify", per-entry leg: "N commits are completion"), as opposed to
 * {@link showNameOnly}'s single-commit diff. `from` need not be an ancestor
 * of `to`; git diffs the two trees directly either way.
 */
export async function diffNameOnly(
  cwd: string,
  from: string,
  to: string,
): Promise<string[]> {
  const { stdout } = await run(cwd, ["diff", "--name-only", from, to]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Whether `ancestor` is a (non-strict) ancestor of `descendant` — `git
 * merge-base --is-ancestor`, exit code `0` for yes and `1` for no. Any other
 * exit code (bad revision, not a repository) rethrows rather than being
 * read as "not an ancestor" (`engine-boundary.md` "Told, not inferred": a
 * failure the probe cannot explain is not silently folded into its negative
 * case).
 */
export async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await run(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 1) return false;
    throw err;
  }
}

/**
 * Cherry-pick every commit in `(base, head]` onto the current tip, in order
 * — a fanout entry's whole span (spec/loop.md "Tip verify", per-entry leg),
 * not just its newest commit. Equivalent to a single-commit cherry-pick when
 * the range holds exactly one commit, so this is the one cherry-pick
 * primitive the dispatcher needs — no separate single-sha form beside it.
 */
export async function cherryPickRange(
  repoRoot: string,
  base: string,
  head: string,
): Promise<void> {
  await run(repoRoot, ["cherry-pick", `${base}..${head}`]);
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
 * as the job dir it was cloned for). No-op off win32. Checks the local
 * config first and skips the write when already `true` — a blind repeat
 * write races an external holder of `.git/config` (downstream incident,
 * @dtmd/flume 0.11.0 win32: EACCES on wave >= 2).
 */
export async function pinLongPaths(repoRoot: string): Promise<void> {
  if (process.platform !== "win32") return;
  if ((await getLocalConfig(repoRoot, "core.longpaths")) === "true") return;
  await run(repoRoot, ["config", "core.longpaths", "true"]);
}

/**
 * `git config --local --get <key>`, read as "unset" rather than an error on
 * the exit-1 case `run()` otherwise throws on (`isAncestor` above is the
 * established pattern for reading a git exit code as data).
 */
async function getLocalConfig(
  repoRoot: string,
  key: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await run(repoRoot, [
      "config",
      "--local",
      "--get",
      key,
    ]);
    return stdout;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 1) return undefined;
    throw err;
  }
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
 * doesn't exist" case is swallowed. "Told, not inferred"
 * (engine-boundary.md) rules out matching git's own English wording for
 * that case out of its stderr — a localized git configuration rephrases
 * it and the match silently stops firing. Structural check instead: probe
 * `refs/heads/<branch>` with `show-ref --verify --quiet` (no stdout, no
 * stderr, only the exit code) and key off that. Any other failure —
 * including a non-1 exit from the probe itself, and anything `branch -D`
 * throws once the ref is confirmed present (most commonly the branch
 * still checked out in a worktree that survived removal) — rethrows so
 * the caller can surface it rather than losing it silently.
 */
export async function deleteBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  try {
    await run(repoRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code === 1) return;
    throw err;
  }
  await run(repoRoot, ["branch", "-D", branch]);
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
 * The three ways `git symbolic-ref --quiet HEAD` fails to name a ref,
 * distinguished so a caller can refuse each with its own message instead of
 * folding them into one "HEAD is detached" reading:
 *
 * - `detached` — a real repo, HEAD just isn't a symbolic ref. Git exits `1`.
 * - `not-a-repository` — `cwd` isn't inside a git working tree at all. Git
 *   exits `128` (its fatal-error convention) rather than `1`.
 * - `git-unavailable` — the `git` process itself never ran (binary missing,
 *   spawn failure) — a `node:child_process` spawn error, not a git exit
 *   code, so its `code` is a string (e.g. `ENOENT`) rather than a number.
 */
export type CurrentRef =
  | { kind: "ref"; path: string }
  | { kind: "detached" }
  | { kind: "not-a-repository" }
  | { kind: "git-unavailable"; message: string };

/**
 * The ref HEAD resolves to (e.g. `refs/heads/main`), or the distinguished
 * reason it could not be named — see `CurrentRef`. `git symbolic-ref` exits
 * non-zero in all three failure cases; only its exit code (or the absence of
 * one, on a spawn failure) tells them apart.
 */
export async function currentRefPath(cwd: string): Promise<CurrentRef> {
  try {
    const { stdout } = await run(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
    return stdout ? { kind: "ref", path: stdout } : { kind: "detached" };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "number") {
      return code === 1 ? { kind: "detached" } : { kind: "not-a-repository" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "git-unavailable", message };
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
      // call won. Loud or nothing (engineering.md): only ENOENT (already
      // gone — another reclaimer won the race) is swallowed; any other
      // failure (e.g. EACCES) rethrows instead of spinning this loop
      // forever.
      try {
        await unlink(toNamespacedPath(claimPath));
      } catch (unlinkErr) {
        if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkErr;
        }
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
