/**
 * git — narrow shell wrapper around the subset of git operations the
 * dispatcher needs. We avoid simple-git or isomorphic-git to keep the
 * dependency surface minimal; eight commands is all we use.
 */

import { execFile } from "node:child_process";
import { unlinkSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

import { existsLoud } from "./fsProbe.js";
import { gitPath } from "./paths.js";
import { parsePidClaim, renderPidClaim } from "./pidClaim.js";

const exec = promisify(execFile);

/**
 * Bounded retries for the recursive-removal fallback below — the
 * EBUSY/ENOTEMPTY class a just-installed, still-settling node_modules produces
 * on win32 (the dogfood symptom: three build waves, three `Directory
 * not empty` failures, hand sweep).
 */
const FALLBACK_REMOVE_MAX_RETRIES = 5;
const FALLBACK_REMOVE_RETRY_DELAY_MS = 200;

/**
 * The environment every git invocation in this engine runs under: the one
 * literal-pathspec spelling.
 *
 * **Nothing this harness hands git after `--` is a pattern.** Every pathspec
 * it passes is a path the host composed — a state-root-relative artifact
 * path, a job dir named by an operator, a filename read back off git's own
 * `--name-only`. Under git's default parse those are globs, so a name
 * carrying `*`, `?` or `[` matches itself *and* every sibling it happens to
 * glob: `git add -- '.flume/plan/a*'` stages sibling `ab` too, and `git
 * rm -r` over the same spelling deletes it (measured, git 2.43). A leading
 * `:` is worse still — read as magic, `:leading.ts` selects nothing and
 * `:(icase)x` exits `128`. Either way the engine acts on a set it was never
 * handed (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * **One spelling, applied at the invocation, not at the argument.** Of git's
 * three literal-pathspec forms, this is the only one that is neither
 * position-bound nor per-path: `--literal-pathspecs` is a main-command
 * option, which `ls-tree` rejects as one of its own (exit `129`), and a
 * `:(literal)` prefix has to be remembered at every call site and re-spelled
 * at every new one. Setting it on the child's environment covers every
 * pathspec of every invocation the wrapper makes, including ones not written
 * yet (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Exported for the sibling wrapper that spawns its own git —
 * `harness/gitRange.ts`'s window reader — so the two surfaces cannot
 * disagree about what a pathspec means.
 */
export function literalPathspecEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_LITERAL_PATHSPECS: "1" };
}

async function run(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await exec("git", args, {
    cwd,
    env: literalPathspecEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
}

export async function revParse(cwd: string, ref = "HEAD"): Promise<string> {
  const { stdout } = await run(cwd, ["rev-parse", ref]);
  return stdout;
}

/**
 * Thrown by {@link resetKeepTo} when git refuses the reset — a path the
 * reset would touch also carries an uncommitted change of its own. `git
 * reset --keep` is transactional: on this refusal it has updated nothing,
 * so both the engine's span and the bystander's uncommitted content are
 * exactly as they were before the call. `gitMessage` carries git's own
 * stderr for the operator's log, never parsed by the caller — the engine
 * does not classify *why* --keep refused
 * (`.claude/rules/engine-boundary.md`, "Told, not inferred"), only that it
 * did.
 */
export class ResetKeepRefusedError extends Error {
  constructor(
    public readonly cwd: string,
    public readonly targetSha: string,
    public readonly gitMessage: string,
  ) {
    super(
      `reset --keep to ${targetSha} refused in ${cwd}: ${gitMessage} — ` +
        `uncommitted state collides with the revert; both writers' work ` +
        `left in place`,
    );
  }
}

/**
 * Reset the branch pointer to `sha`, preserving uncommitted state the
 * caller did not author (spec/loop.md "Tip verify", "dropping it must not
 * take bystanders") — `git reset --keep`, never `--hard`, on a checkout
 * that may hold a bystander's staged or unstaged work. `--keep` updates
 * only the paths that differ between the current tip and `sha`; a path
 * among those that also carries an uncommitted change of its own makes git
 * refuse the whole reset atomically rather than silently discard either
 * side, which this surfaces as {@link ResetKeepRefusedError}. The caller's
 * only safe move on that refusal is to propagate it — never fall back to
 * `reset --hard`, which is exactly the wipe this primitive exists to avoid.
 */
export async function resetKeepTo(cwd: string, sha: string): Promise<void> {
  try {
    await run(cwd, ["reset", "--keep", sha]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ResetKeepRefusedError(cwd, sha, message);
  }
}

/**
 * Soft reset directly to a specific sha, rather than a commit count back
 * from HEAD. Used by the per-entry tip-verify leg (spec/loop.md "Tip
 * verify"): the target is the recorded base itself, which on a refusal is
 * not necessarily an ancestor of the current tip (that is exactly what the
 * ancestry check failed on) — so counting commits back from HEAD does not
 * apply. `reset --soft` accepts any commit-ish regardless of ancestry: it
 * moves the branch ref and index, leaving the working tree (and therefore
 * the abandoned commits' content) in place as uncommitted state.
 */
export async function softResetTo(cwd: string, sha: string): Promise<void> {
  await run(cwd, ["reset", "--soft", sha]);
}

/**
 * Decode the `-z` form of a `--name-only` listing: NUL-terminated fields,
 * each the path exactly as git committed it.
 *
 * **Every reader passes `-z`, because neither the default form's spelling nor
 * its separator is faithful.** Measured on git 2.43:
 *
 * - A path carrying a non-ASCII byte or a control character comes back
 *   double-quoted with the offending bytes octal-escaped: `src/café.ts`
 *   arrives as `"src/caf\303\251.ts"`. That spelling is a *different* path
 *   than the one committed — it matches no fence glob, so a path the tick was
 *   meant to write reads as out-of-fence; it enters an entry's
 *   `observedFiles` as a name no later partition can key on; and it resolves
 *   nothing fed back to git as `<sha>:<path>`
 *   (`.claude/rules/engineering.md`, *Loud or nothing*).
 * - `core.quotePath=false` is measured non-viable as the fix. It un-quotes
 *   the non-ASCII case only: a control character stays quoted either way, and
 *   a path containing a newline then splits into two paths under the default
 *   form's line separator, which no un-quoting can undo.
 *
 * No per-field trim, for a second and independent reason: a space is *not*
 * quoted by either form, so a committed path legitimately arrives still
 * ending in one, and trimming it silently substitutes another path for the
 * one git named. Empty fields are dropped — the trailing NUL after the last
 * path yields one, and a commit touching nothing yields only that.
 *
 * Exported for the sibling readers that spawn their own git —
 * `harness/gitRange.ts` reads `log --name-only -z` and `ls-files -z` through
 * this same decode — so no surface grows a second idea of what git named
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). The
 * listing verb is the caller's; the decode is not.
 */
export function nameOnlyPaths(stdout: string): string[] {
  return stdout.split("\0").filter((p) => p.length > 0);
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
  const { stdout } = await run(cwd, ["diff", "--name-only", "-z", from, to]);
  return nameOnlyPaths(stdout);
}

/**
 * Whether `ancestor` is a (non-strict) ancestor of `descendant` — `git
 * merge-base --is-ancestor`, exit code `0` for yes and `1` for no. Any other
 * exit code (bad revision, not a repository) rethrows rather than being
 * read as "not an ancestor" (`.claude/rules/engine-boundary.md` "Told, not
 * inferred": a failure the probe cannot explain is not silently folded into
 * its negative case).
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
 * `expectedSha` names the commit this call itself created — the caller's own
 * `postHead`, still in scope from the commit it just made. Refuses rather than
 * reset when the current tip has moved on: two supervisors on one tree means a
 * stale caller could otherwise drop a commit it never created.
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
 * win32 MAX_PATH guard: repo-locally pin `core.longpaths` before any operation
 * that nests paths deep enough to exceed it — a worktree under the state
 * root's base, and everything a tick writes inside it. Both provisioning
 * sites (`src/worktrees.ts`) call it before `git worktree add`. No-op off
 * win32. Checks the local config
 * first and skips the write when already `true` — a blind repeat write races
 * an external holder of `.git/config` (downstream incident, @dtmd/flume 0.11.0
 * win32: EACCES on wave >= 2).
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
    const { stdout } = await run(repoRoot, ["config", "--local", "--get", key]);
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
  /**
   * The branch to create or reset at `fromRef`. Omitted checks `fromRef`
   * out **detached** — a worktree nothing commits to, for a caller that
   * wants a second tree at a known sha and no ref to clean up afterwards.
   */
  branch?: string;
  fromRef: string;
}): Promise<void> {
  await run(opts.repoRoot, [
    "worktree",
    "add",
    ...(opts.branch === undefined ? ["--detach"] : ["-B", opts.branch]),
    opts.path,
    opts.fromRef,
  ]);
}

/**
 * Remove a worktree, falling back past a bare `git worktree remove --force`
 * failure. On win32, a just-installed pnpm `node_modules` commonly still has
 * handles open when teardown runs, turning `--force` into `Directory not
 * empty` instead of a clean removal.
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
  // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
  // on anything but ENOENT, so a survivor this process cannot stat — a
  // permission-denied parent, a symlink loop — reports as a survivor rather
  // than as a clean removal the caller would then prune and forget
  // (`.claude/rules/engineering.md`, "Loud or nothing"). `existsSync` read
  // both as gone.
  if (existsLoud(toNamespacedPath(path))) {
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
 * Loud or nothing (.claude/rules/engineering.md): only the expected-benign
 * "branch doesn't exist" case is swallowed. "Told, not inferred"
 * (.claude/rules/engine-boundary.md) rules out matching git's own English
 * wording for that case out of its stderr — a localized git configuration
 * rephrases it and the match silently stops firing. Structural check
 * instead: probe `refs/heads/<branch>` with `show-ref --verify --quiet` (no
 * stdout, no stderr, only the exit code) and key off that. Any other failure
 * — including a non-1 exit from the probe itself, and anything `branch -D`
 * throws once the ref is confirmed present (most commonly the branch still
 * checked out in a worktree that survived removal) — rethrows so the caller
 * can surface it rather than losing it silently.
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
 *
 * `excludeDeleted` drops the paths the commit *removed* (`--diff-filter=d`),
 * leaving only those still readable at `sha` — what a caller that goes on to
 * read each path's content at that same commit wants
 * (`PriorAttemptStore.snapshotReverted`, src/priorAttempts.ts). A typed flag
 * rather than a pass-through filter string: the engine forwards only the
 * selection it consumes, and a mistyped filter letter is then not a thing a
 * caller can express.
 */
export async function showNameOnly(
  repoRoot: string,
  sha: string,
  opts: { excludeDeleted?: boolean } = {},
): Promise<string[]> {
  const { stdout } = await run(repoRoot, [
    "show",
    "--name-only",
    ...(opts.excludeDeleted ? ["--diff-filter=d"] : []),
    "--format=",
    "-z",
    sha,
  ]);
  return nameOnlyPaths(stdout);
}

/**
 * Read a path's content as committed at `ref` (`git show <ref>:<path>`) —
 * spec/pending.md "Dispatch reads come from the tip, not the tree": every
 * strict pending.json read resolves the committed tip, never the working
 * tree. Returns `null` when the path is absent from that ref's tree,
 * mirroring a plain absence check for the disk read this replaces rather
 * than a distinct failure mode.
 *
 * Existence is probed with `ls-tree` first — clean exit, empty stdout for
 * "not in this tree" — rather than parsing `git show`'s fatal-error exit
 * code, which is the same `128` for "path missing" as for every other fatal
 * condition (bad ref, not a repository) and so cannot structurally
 * distinguish them (`.claude/rules/engine-boundary.md` "Told, not
 * inferred"; the `isAncestor`/`deleteBranch` structural-probe pattern above,
 * applied here).
 *
 * That probe's pathspec is matched as the path it is and never re-read as
 * magic, because every invocation here runs under {@link
 * literalPathspecEnv}. A committed name may begin with `:` — git lists it,
 * `<ref>:<path>` resolves it — but a default pathspec parse takes the
 * leading colon as a magic prefix: `:leading.ts` lists nothing (so an
 * existing path reads back `null`) and `:(icase)x` exits 128 (so the whole
 * read throws). Both are the engine substituting a verdict for a path it was
 * handed (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Content comes straight off `exec`, not `run()`: `run()`'s `trimEnd()` is
 * right for git's own line-oriented output but would silently drop a real
 * file's trailing bytes — a content read wants exactly what was committed.
 * It carries the same environment, so the two legs of one read cannot run
 * under different git dialects.
 */
export async function readFileAtRef(
  repoRoot: string,
  ref: string,
  relPath: string,
): Promise<string | null> {
  const pathspec = gitPath(relPath);
  const { stdout: listing } = await run(repoRoot, [
    "ls-tree",
    "--name-only",
    ref,
    "--",
    pathspec,
  ]);
  if (listing.trim().length === 0) return null;
  const { stdout } = await exec("git", ["show", `${ref}:${pathspec}`], {
    cwd: repoRoot,
    env: literalPathspecEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/**
 * `git rev-parse --git-path <relPath>` — the checkout-relative path git
 * itself resolves for a piece of its own state, rather than this caller
 * assuming `.git/<relPath>` directly (right for a linked worktree, where
 * `CHERRY_PICK_HEAD`/`sequencer/` live under `.git/worktrees/<name>/`, not
 * under the shared common dir `gitCommonDir` resolves).
 */
async function revParseGitPath(
  repoRoot: string,
  relPath: string,
): Promise<string> {
  const { stdout } = await run(repoRoot, ["rev-parse", "--git-path", relPath]);
  return resolve(repoRoot, stdout);
}

/**
 * Whether a cherry-pick sequence has actually started on this checkout —
 * `CHERRY_PICK_HEAD` or a `sequencer/` directory present, git's own state
 * for an in-progress (possibly multi-commit) pick. Read structurally off
 * disk, never inferred from a prior call's outcome
 * (`.claude/rules/engine-boundary.md` "Told, not inferred").
 */
async function hasCherryPickSequencerState(repoRoot: string): Promise<boolean> {
  const [headPath, sequencerPath] = await Promise.all([
    revParseGitPath(repoRoot, "CHERRY_PICK_HEAD"),
    revParseGitPath(repoRoot, "sequencer"),
  ]);
  // Absent is the only silent reading (`existsLoud`, src/fsProbe.ts): an
  // unstattable `CHERRY_PICK_HEAD`/`sequencer/` would otherwise read as "no
  // sequence started", and the abort that spec/loop.md "Crash equals stop"
  // owes an interrupted pick would be skipped over a checkout still holding
  // the pick's state (`.claude/rules/engineering.md`, "Loud or nothing").
  return (
    existsLoud(toNamespacedPath(headPath)) ||
    existsLoud(toNamespacedPath(sequencerPath))
  );
}

/**
 * Abort an in-progress cherry-pick, restoring the working tree to its
 * pre-cherry-pick state — but only when a sequence actually started
 * (spec/loop.md "Crash equals stop": "An abort is issued only against a
 * sequence that started"). Called with nothing to abort at all — no
 * `cherryPickRange` call preceded it this process, or git never got far
 * enough to write `CHERRY_PICK_HEAD`/`sequencer/` state in the first place
 * — this issues no `--abort` (only the two `rev-parse --git-path` probes
 * the state read costs): a blind `--abort` there would reset the
 * operator's index and working tree for no reason. Once a range pick has
 * been attempted, git's own sequencer bookkeeping for that range is on disk
 * even when the very first commit's pre-flight check refuses (e.g. an
 * operator's uncommitted change colliding with a path the pick would
 * touch) — in that case the guard here still lets `--abort` run, since a
 * sequence did start in git's own accounting; `checkpointBystanderState`
 * below is what makes that abort's own fallout recoverable, not this
 * guard. Still idempotent past the check: a sequence that clears between
 * the check and the call is swallowed, nothing left to clean up.
 */
export async function cherryPickAbort(repoRoot: string): Promise<void> {
  if (!(await hasCherryPickSequencerState(repoRoot))) return;
  try {
    await run(repoRoot, ["cherry-pick", "--abort"]);
  } catch {
    // Sequencer state was present a moment ago but cleared before the
    // abort landed — nothing left to clean up.
  }
}

/**
 * Capture whatever is staged or unstaged on the primary checkout as a
 * dangling commit — `git stash create`'s shape: an object is written, no
 * ref moves, nothing is reset or touched on disk (spec/loop.md "Crash
 * equals stop": "Staged bystander state is checkpointed before a pick
 * range begins"). The operator's work stays exactly where it is; the sha
 * is recovery insurance for if a later `--abort` or gate-revert reset
 * disturbs it. Returns `undefined` when the tree was clean — `git stash
 * create` itself prints nothing to capture in that case.
 */
export async function checkpointBystanderState(
  repoRoot: string,
): Promise<string | undefined> {
  const { stdout } = await run(repoRoot, ["stash", "create"]);
  return stdout.length > 0 ? stdout : undefined;
}

/**
 * Stage a specific set of paths and commit.
 *
 * `paths` are staged as the paths they are, never as patterns: the stage
 * runs under {@link literalPathspecEnv}, so an artifact whose name carries a
 * glob metacharacter stages itself alone rather than itself plus every
 * sibling it happens to match. The commit takes no pathspec of its own, so
 * an over-matched sibling would ride along in full.
 */
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
 * (following the `git-lfs`/`sequencer` precedent for shared, untracked tool
 * state under `.git/`).
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
 * Where the tip claim for `refPath` lives under a git-common-dir: the ref path
 * mirrored as directories, e.g.
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
 * under different keying. What the two *do* share is the statement they read:
 * `parsePidClaim` (`src/pidClaim.ts`), which takes the pid off the first
 * line, so a claim carrying its instant on the second reads here exactly as
 * a bare pid did.
 *
 * Absent is the only silent reading (`existsLoud`, src/fsProbe.ts). A claim
 * file that is present but unstattable is not an unclaimed tip: read as one,
 * `acquireTipClaim`'s EEXIST branch would take the dead-pid path and reclaim
 * a tip another live writer holds — the refusal that branch exists to make
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
export async function liveTipClaimPid(
  claimPath: string,
): Promise<number | null> {
  if (!existsLoud(toNamespacedPath(claimPath))) return null;
  const claim = parsePidClaim(
    await readFile(toNamespacedPath(claimPath), "utf8"),
  );
  if (claim === null) return null;
  try {
    process.kill(claim.pid, 0);
    return claim.pid;
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

interface TipClaim {
  path: string;
  /** Remove the claim file. Idempotent — safe to call from an exit handler. */
  release: () => void;
}

/**
 * Acquire the advisory per-ref tip claim: one flume writer per tip.
 * Exclusive-create (`wx`) the claim file at
 * `<git-common-dir>/flume/tip-claims/<refPath>`. The file states the holder's
 * pid on the first line and the instant of this call on the second — the same
 * shape `loop.pid` carries (`renderPidClaim`, `src/pidClaim.ts`). On
 * `EEXIST`, probe the recorded pid with the same liveness check as the loop
 * lock: live → refuse ({@link TipClaimHeldError}, naming the holder); dead →
 * reclaim (unlink, retry the exclusive create).
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
      await writeFile(
        toNamespacedPath(claimPath),
        renderPidClaim(process.pid, new Date()),
        { flag: "wx" },
      );
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
      // call won. Loud or nothing (.claude/rules/engineering.md): only
      // ENOENT (already gone — another reclaimer won the race) is swallowed;
      // any other failure (e.g. EACCES) rethrows instead of spinning this
      // loop forever.
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

/**
 * One `git status --porcelain` record, decoded.
 *
 * The record's own two fields and nothing derived from them: what git said
 * about a path, never what a caller should do about it
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported*).
 */
export interface GitStatusRecord {
  /**
   * The two-byte `XY` code porcelain v1 prefixes the record with, verbatim —
   * index status then worktree status, spaces included, so `" M"` and `"M "`
   * stay distinguishable and `"??"` is readable as untracked.
   */
  readonly code: string;
  /** The path the record is about, as it stands on disk now. */
  readonly path: string;
}

/**
 * Every path `git status` reports dirty in `cwd` right now, decoded — the
 * single porcelain walk in the tree. A caller wanting a subset filters these
 * records; it does not spawn its own `git status` and re-decode the same
 * bytes beside this one.
 *
 * spec/loop.md "Tip verify": an agent's worktree is removed at teardown along
 * with everything uncommitted in it, and a soft-reset span's content lands
 * back here as exactly this kind of residue. The engine reads the set while
 * the worktree still exists so the tick verdict can name what was lost —
 * the fact alone; what it means is the chain's.
 *
 * `--untracked-files=all` is asked for unconditionally, so an untracked
 * directory arrives as the files inside it rather than as one directory
 * record a caller filtering on names could not match. A caller that drops
 * `??` outright — {@link trackedModifications} — is unaffected by the
 * expansion, which is why one call serves both.
 *
 * `-z`, for {@link nameOnlyPaths}' reasons applied to a status listing: the
 * default form double-quotes any path carrying a space, a control character,
 * or a non-ASCII byte, and a quoted spelling names a different path than the
 * one on disk. A rename or copy record spends a second NUL field on the path
 * it came from; that field carries no status code, so it is consumed here
 * rather than read as a record of its own — the surviving path is the one
 * reported.
 *
 * The porcelain default already omits `!!`, so ignored paths never appear.
 */
export async function statusRecords(cwd: string): Promise<GitStatusRecord[]> {
  const { stdout } = await run(cwd, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
  ]);
  const fields = stdout.split("\0");
  const decoded: GitStatusRecord[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (!field) continue;
    const code = field.slice(0, 2);
    if (code.includes("R") || code.includes("C")) i += 1;
    decoded.push({ code, path: field.slice(3) });
  }
  return decoded;
}

/**
 * {@link statusRecords} filtered to tracked paths — staged, unstaged, or
 * both. The decode, the `-z` reasoning and the rename-origin handling all
 * live there.
 *
 * **Tracked only.** An untracked file has no committed counterpart to have
 * been modified away from, and a worktree's untracked set is dominated by
 * build output nobody lost (`node_modules`, caches). `??` records are
 * therefore dropped.
 */
export async function trackedModifications(cwd: string): Promise<string[]> {
  const records = await statusRecords(cwd);
  return records.filter((r) => r.code !== "??").map((r) => r.path);
}

/**
 * The git `worktree list --porcelain -z` needs — the read worktree
 * reclamation is built on (`readWorktreeRegistry`, `src/worktrees.ts`), which
 * git grew in 2.36 (spec/chain.md, *The package a chain loads through*).
 *
 * Major and minor alone: git's patch level has never gated a subcommand
 * option, and a floor spelled to the patch would refuse a distribution
 * backport that carries the option.
 */
export const WORKTREE_LIST_Z_FLOOR = { major: 2, minor: 36 } as const;

/**
 * What `git --version` said about the git this process will run, decoded —
 * or why nothing could be read from it.
 *
 * A fact, never a verdict: this says which git answered and whether it
 * carries the option the engine reads, not what a caller should do about it
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported*).
 */
export type GitVersion =
  | {
      readonly read: true;
      /**
       * git's own line, verbatim — `git version 2.43.0`, and whatever the
       * host appends to it (`.windows.1`, ` (Apple Git-145)`). Reported
       * rather than re-spelled from the numbers below, so a message naming
       * the version names the one the operator would see themselves.
       */
      readonly line: string;
      readonly major: number;
      readonly minor: number;
      /** Whether this git carries {@link WORKTREE_LIST_Z_FLOOR}'s option. */
      readonly meetsWorktreeListZFloor: boolean;
    }
  | { readonly read: false; readonly reason: string };

/**
 * git's version line, decoded.
 *
 * Reading a version out of an English line is pattern-matching prose the
 * engine did not author (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*) — the sanctioned exception, declared here: git exposes its
 * version through no other channel, there is no exit code or porcelain form
 * to key on instead, and `git version <major>.<minor>` is the documented
 * opening of that line on every host. Only the opening is read; everything a
 * distribution appends past the minor is carried verbatim in {@link
 * GitVersion.line} rather than parsed.
 *
 * A line that does not open that way is **unread**, never guessed at: a
 * version inferred from an unrecognized spelling would decide the floor
 * silently and wrongly (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function parseGitVersion(line: string): GitVersion {
  const said = line.trim();
  const fields = /^git version (\d+)\.(\d+)/.exec(said);
  if (!fields) {
    return {
      read: false,
      reason: `\`git --version\` said ${JSON.stringify(said)}, which does not open \`git version <major>.<minor>\``,
    };
  }
  const major = Number(fields[1]);
  const minor = Number(fields[2]);
  return {
    read: true,
    line: said,
    major,
    minor,
    meetsWorktreeListZFloor:
      major > WORKTREE_LIST_Z_FLOOR.major ||
      (major === WORKTREE_LIST_Z_FLOOR.major &&
        minor >= WORKTREE_LIST_Z_FLOOR.minor),
  };
}

/**
 * Run `git --version` in `cwd` and decode it through {@link parseGitVersion}.
 *
 * A git that cannot be started at all — absent from PATH, not executable —
 * arrives as an unread reading carrying the spawn's own message, not as a
 * throw: the caller reading this is asking which git it has, and a host with
 * no git answers that question rather than ending the run early. Every other
 * git call in this module still fails on its own terms.
 */
export async function readGitVersion(cwd: string): Promise<GitVersion> {
  try {
    const { stdout } = await run(cwd, ["--version"]);
    return parseGitVersion(stdout);
  } catch (err) {
    return { read: false, reason: (err as Error).message };
  }
}
