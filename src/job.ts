/**
 * `flume job` — lifecycle verbs over the job convention (v0.5 §5): a job is
 * a branch plus a state root, both named by convention —
 * `.flume/jobs/<name>/` (tracked, runtime subdirs ignored) on branch
 * `job/<name>`. Machinery only: no presets, no encoded checks, no harness
 * content — content arrives via `--template`, caller-owned.
 *
 * `src/cli.ts` routes `flume job <verb>` here. Git access is a local thin
 * wrapper: the verbs speak porcelain (`checkout`, `add`, `commit`,
 * `config`), a different surface from `src/git.ts`'s dispatcher plumbing.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Baton } from "./Baton.js";
import { loadChainModule } from "./Dispatcher.js";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));

/** Usage-shaped failure (bad name, missing template): the CLI maps it to exit 2. */
export class JobUsageError extends Error {}

/**
 * Runtime-owned entries ensured in every job dir's `.gitignore` (§5a-3).
 * The runtime owns its layout; chain-convention dirs (`sessions/`) are the
 * template's to add.
 */
export const RUNTIME_IGNORES = [
  "awake/",
  "prior-attempts/",
  "worktrees/",
  "node_modules/",
  "loop.pid",
] as const;

/**
 * A job name must be usable verbatim as one path segment
 * (`.flume/jobs/<name>`) and one branch segment (`job/<name>`) — reject
 * anything that would escape either construction, before any dir or branch
 * is built. Returns the rejection reason, or `null` for a valid name.
 * (The creating verb is where shape is enforced; `--job` resolution trusts
 * its input — accepted debt from the JOB-RESOLUTION audit.)
 */
export function validateJobName(name: string): string | null {
  if (!name) return "job name is empty";
  if (/[\\/]/.test(name)) {
    return `job name '${name}' contains a path separator; a job name is a single segment of .flume/jobs/<name> and job/<name>`;
  }
  if (name === "." || name === "..") {
    return `job name '${name}' is not a usable path segment`;
  }
  return null;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr ?? e.message ?? "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge {@link RUNTIME_IGNORES} into `<jobDir>/.gitignore` — create the file
 * if absent, append only the missing entries otherwise. Idempotent;
 * template-authored lines (and their order) are preserved verbatim.
 */
export async function ensureRuntimeIgnores(jobDir: string): Promise<void> {
  const path = join(jobDir, ".gitignore");
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = RUNTIME_IGNORES.filter((entry) => !have.has(entry));
  if (missing.length === 0) return;
  const base =
    existing.length === 0 || existing.endsWith("\n") ? existing : existing + "\n";
  await writeFile(path, base + missing.join("\n") + "\n", "utf8");
}

/**
 * Provision `<jobDir>/node_modules/@dtmd/flume` as a junction (win32) or
 * symlink to `target` (§5a-4). Skip only if the link already exists; a
 * non-link squatting on the path is a loud error, not a silent skip.
 */
async function ensureFlumeLink(jobDir: string, target: string): Promise<void> {
  const linkPath = join(jobDir, "node_modules", "@dtmd", "flume");
  try {
    const st = await lstat(linkPath);
    if (st.isSymbolicLink()) return;
    throw new Error(
      `${linkPath} exists and is not a link; remove it and re-run \`flume job new\``,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(
    target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

export interface JobNewOptions {
  repoRoot: string;
  name: string;
  /** Seed the job dir from this directory (verbatim recursive copy). */
  template?: string;
  /**
   * Link target for `<jobDir>/node_modules/@dtmd/flume`. Defaults to the
   * running CLI's own package root (`resolve(HERE, "..")`) — version
   * coherence: the chain resolves the exact flume that ticks it, even when
   * the repo declares another version. Injectable as the test seam for the
   * no-dep-tree fixture.
   */
  linkTarget?: string;
  log?: (line: string) => void;
}

/**
 * `flume job new <name> [--template <dir>]` (v0.5 §5a). From current HEAD:
 * branch `job/<name>` (reuse if it exists), seed `.flume/jobs/<name>/`,
 * ensure runtime ignores, link `@dtmd/flume`, pin `core.longpaths` (win32),
 * baseline-commit the harness, stay on the branch. Idempotent on re-run.
 *
 * Throws {@link JobUsageError} on usage-shaped input (exit 2 at the CLI);
 * any other throw is an operational failure (exit 1).
 */
export async function jobNew(opts: JobNewOptions): Promise<void> {
  const { repoRoot, name } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);
  if (opts.template !== undefined) {
    if (!existsSync(opts.template)) {
      throw new JobUsageError(`--template dir not found: ${opts.template}`);
    }
    if (!statSync(opts.template).isDirectory()) {
      throw new JobUsageError(`--template is not a directory: ${opts.template}`);
    }
  }

  // 1. Branch by convention, from current HEAD; reuse an existing job branch.
  const branch = `job/${name}`;
  const reuse = await branchExists(repoRoot, branch);
  await git(
    repoRoot,
    reuse ? ["checkout", "-q", branch] : ["checkout", "-q", "-b", branch],
  );
  log(`[flume] ${reuse ? "reusing branch" : "created branch"} ${branch}`);

  // 2. Seed the state root. Verbatim copy — the template owns its content.
  const jobDir = join(repoRoot, ".flume", "jobs", name);
  await mkdir(jobDir, { recursive: true });
  if (opts.template !== undefined) {
    await cp(opts.template, jobDir, { recursive: true });
    log(`[flume] seeded ${jobDir} from ${opts.template}`);
  } else {
    log(
      `[flume] warning: no --template — job dir is empty; populate ${jobDir} (chain.ts, prompts) before \`flume job run ${name}\``,
    );
  }

  // 3. Runtime ignores — written before the baseline add so runtime state
  // and the link below never enter the commit.
  await ensureRuntimeIgnores(jobDir);

  // 4. Unconditional provisioning (§5a-4, resolved decision 5).
  await ensureFlumeLink(jobDir, opts.linkTarget ?? resolve(HERE, ".."));

  // 5. Job dirs nest deep; spare the operator MAX_PATH failures up front.
  if (process.platform === "win32") {
    await git(repoRoot, ["config", "core.longpaths", "true"]);
  }

  // 6. Baseline-commit the seeded harness so plan/build produce clean deltas.
  // The commit is pathspec-scoped: anything the operator pre-staged outside
  // the job dir stays in the index instead of being swept into the seed.
  const rel = join(".flume", "jobs", name);
  await git(repoRoot, ["add", "--", rel]);
  const staged = await git(repoRoot, ["status", "--porcelain", "--", rel]);
  if (staged.length > 0) {
    await git(repoRoot, [
      "commit",
      "-q",
      "-m",
      `chore(flume): seed job ${name}`,
      "--",
      rel,
    ]);
    log(`[flume] baseline commit on ${branch}`);
  } else {
    log(`[flume] harness already baselined; nothing to commit`);
  }
  // 7. Stay on job/<name> — tune, then `flume job run`.
}

export interface JobRunOptions {
  repoRoot: string;
  name: string;
  /** Job state root — where the baton lives (resolved by the CLI, §3). */
  flumeDir: string;
  /** Chain dir — `chain.ts` is loaded from here, after the checkout. */
  configDir: string;
  log?: (line: string) => void;
}

/**
 * `flume job run <name>` preflight (v0.5 §5b-1/2): assert-or-checkout
 * `job/<name>`, then wake the chain's entry phase — `chain.phases[0]`, a
 * content-free convention (decision 6, no hardcoded phase names) — iff the
 * baton is hibernating. A non-hibernating baton is left untouched (mid-job
 * resume). The loop itself (§5b-3) is the CLI's standard `flume loop` path
 * under the job resolution; this function owns only the two steps before it.
 *
 * Throws {@link JobUsageError} on a bad name or a branch that does not exist
 * (the job was never created — exit 2 at the CLI); any other throw is an
 * operational failure (exit 1).
 */
export async function jobRun(opts: JobRunOptions): Promise<void> {
  const { repoRoot, name, flumeDir, configDir } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);

  // 1. Assert-or-checkout. Checkout is a verb act (§2 HEAD-is-truth): the
  // loop never switches branches, so the switch happens here or not at all.
  // Inside a linked worktree already on job/<name> (the §6 concurrency
  // recipe) the assert passes and no checkout runs — git would refuse to
  // check out a branch another worktree holds anyway.
  const branch = `job/${name}`;
  if (!(await branchExists(repoRoot, branch))) {
    throw new JobUsageError(
      `branch ${branch} does not exist; create the job first: flume job new ${name}`,
    );
  }
  const head = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head === branch) {
    log(`[flume] on ${branch}`);
  } else {
    await git(repoRoot, ["checkout", "-q", branch]);
    log(`[flume] checked out ${branch}`);
  }

  // 2. Wake the entry phase iff hibernating. The chain loads AFTER the
  // checkout — chain.ts lives on the job branch.
  const baton = new Baton(flumeDir);
  if (!baton.hibernating()) {
    log(
      `[flume] baton awake (${baton.awake().join(", ")}); resuming mid-job, entry phase untouched`,
    );
    return;
  }
  const { default: chain } = await loadChainModule(
    resolve(configDir, "chain.ts"),
  );
  const entry = chain.phases[0];
  if (!entry) {
    throw new Error(`chain at ${configDir} declares no phases; nothing to wake`);
  }
  baton.wake(entry.name);
  log(`[flume] woke ${entry.name} (entry phase)`);
}

export interface JobRmOptions {
  repoRoot: string;
  name: string;
  log?: (line: string) => void;
}

/**
 * `flume job rm <name>` (v0.5 §5c) — the discard ending: throw the harness
 * away, keep the work. Refuse while the job's `loop.pid` records a live pid;
 * `git rm -r` the tracked harness plus a cleanup commit on `job/<name>`;
 * remove untracked runtime remnants; `git worktree prune`. The job branch
 * survives — integration (merge/squash) and branch deletion are the
 * operator's acts, never rm's.
 *
 * Throws {@link JobUsageError} on a bad name or a name that names no job
 * (exit 2 at the CLI); a live loop or git failure is an operational error
 * (exit 1).
 */
export async function jobRm(opts: JobRmOptions): Promise<void> {
  const { repoRoot, name } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);

  const branch = `job/${name}`;
  const jobDir = join(repoRoot, ".flume", "jobs", name);
  const rel = join(".flume", "jobs", name);
  const haveBranch = await branchExists(repoRoot, branch);
  if (!haveBranch && !existsSync(jobDir)) {
    throw new JobUsageError(
      `no job '${name}': neither branch ${branch} nor ${rel} exists`,
    );
  }

  // 1. Refuse while the loop is live — removing the state root out from
  // under a running supervisor would strand its ticks. Checked before the
  // checkout below: a live loop implies the branch is HEAD somewhere, and
  // switching under it is exactly the race this refusal exists to prevent.
  // Same liveness probe as the loop lock: a dead (or not-ours) pid is stale.
  const pidPath = join(jobDir, "loop.pid");
  if (existsSync(pidPath)) {
    const pid = Number((await readFile(pidPath, "utf8")).trim());
    let alive = false;
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        // dead or not ours — stale, reclaim silently
      }
    }
    if (alive) {
      throw new Error(
        `job '${name}' has a live loop (pid ${pid}); stop it before \`flume job rm\``,
      );
    }
  }

  // 2. Cleanup commit on the job branch (checkout is a verb act, §2). A
  // branchless dir is a half-created job — clean up on the current HEAD.
  if (haveBranch) {
    const head = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head !== branch) {
      await git(repoRoot, ["checkout", "-q", branch]);
      log(`[flume] checked out ${branch}`);
    }
  }
  const tracked = await git(repoRoot, ["ls-files", "--", rel]);
  if (tracked.length > 0) {
    await git(repoRoot, ["rm", "-q", "-r", "--", rel]);
    // Pathspec-scoped, like the seed commit: anything the operator staged
    // outside the job dir stays in the index instead of riding along.
    await git(repoRoot, [
      "commit",
      "-q",
      "-m",
      `chore(flume): rm job ${name}`,
      "--",
      rel,
    ]);
    log(`[flume] cleanup commit on ${haveBranch ? branch : "HEAD"}`);
  } else {
    log(`[flume] no tracked harness under ${rel}; nothing to commit`);
  }

  // 3. Untracked runtime remnants (awake/, prior-attempts/, the @dtmd/flume
  // link, pid files) — the ignore entries kept them out of git, so git rm
  // left them behind. fs.rm unlinks the junction/symlink without following
  // it; the link target is never touched.
  await rm(jobDir, { recursive: true, force: true });

  // 4. Stale metadata from the job's fanout worktrees.
  await git(repoRoot, ["worktree", "prune"]);
  log(
    `[flume] removed ${rel}; branch ${branch} survives — merge or delete it when integrated`,
  );
}
