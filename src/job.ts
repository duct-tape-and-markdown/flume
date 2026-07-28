/**
 * `flume job` — lifecycle verbs over the job convention (v0.5 §5): a job is
 * a branch plus a state root, both named by convention —
 * `.flume/jobs/<name>/` (tracked, runtime subdirs ignored) on branch
 * `job/<name>`. Machinery only: no presets, no encoded checks, no harness
 * content — content arrives via the repo chain's `Chain.seedDir` (v0.6 §4),
 * chain-owned.
 *
 * `src/cli.ts` routes `flume job <verb>` here. Git access is a local thin
 * wrapper: the verbs speak porcelain (`checkout`, `add`, `commit`,
 * `config`), a different surface from `src/git.ts`'s dispatcher plumbing.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
import { parsePending } from "./PendingSchema.js";

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
 * Merge {@link RUNTIME_IGNORES} — plus any caller-supplied `extra` entries
 * (a declared `Chain.friction` dir, per v0.6.2 §3) — into `<jobDir>/.gitignore`:
 * create the file if absent, append only the missing entries otherwise.
 * Idempotent; template-authored lines (and their order) are preserved
 * verbatim.
 */
export async function ensureRuntimeIgnores(
  jobDir: string,
  extra: readonly string[] = [],
): Promise<void> {
  const path = join(jobDir, ".gitignore");
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = [...RUNTIME_IGNORES, ...extra].filter(
    (entry) => !have.has(entry),
  );
  if (missing.length === 0) return;
  const base =
    existing.length === 0 || existing.endsWith("\n") ? existing : existing + "\n";
  await writeFile(path, base + missing.join("\n") + "\n", "utf8");
}

/**
 * `<friction>/` as it belongs in `.gitignore` — forward-slashed and
 * single-trailing-slashed regardless of how the chain wrote the declaration
 * (`Chain.friction` is validated relative at load time; this only shapes it
 * for the ignore line).
 */
function frictionIgnoreEntry(friction: string): string {
  return `${friction.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
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
  /**
   * Chain + prompts dir the repo chain (and a declared `Chain.seedDir`)
   * resolve against — repo-resident (v0.6 §2), never the job dir. Defaults
   * to `<repoRoot>/.flume`, the same default the CLI resolves absent an
   * explicit `FLUME_CONFIG_DIR`.
   */
  configDir?: string;
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
 * `flume job new <name>` (v0.6 §4). From current HEAD: branch `job/<name>`
 * (reuse if it exists), load the repo chain — no `<configDir>/chain.ts` is a
 * usage error, since a job that could never `run` must not be creatable —
 * then copy its declared `seedDir` into `.flume/jobs/<name>/` verbatim,
 * skip-existing (a declared-but-absent `seedDir` is the same class of usage
 * error; an undeclared `seedDir` seeds nothing, no warning), ensure runtime
 * ignores, link `@dtmd/flume`, pin `core.longpaths` (win32), baseline-commit
 * the harness, stay on the branch. Idempotent on re-run.
 *
 * Throws {@link JobUsageError} on usage-shaped input (exit 2 at the CLI);
 * any other throw is an operational failure (exit 1).
 */
export async function jobNew(opts: JobNewOptions): Promise<void> {
  const { repoRoot, name } = opts;
  const configDir = opts.configDir ?? join(repoRoot, ".flume");
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);

  // 1. Branch by convention, from current HEAD; reuse an existing job branch.
  const branch = `job/${name}`;
  const reuse = await branchExists(repoRoot, branch);
  await git(
    repoRoot,
    reuse ? ["checkout", "-q", branch] : ["checkout", "-q", "-b", branch],
  );
  log(`[flume] ${reuse ? "reusing branch" : "created branch"} ${branch}`);

  // 2. Load the repo chain — after the checkout, so the checkout decides
  // which branch's copy is on disk (mirrors jobRun). The residency invariant
  // (v0.6 §2) guarantees a chain exists before any job does; a chainless
  // repo cannot run the job it would create.
  const chainPath = resolve(configDir, "chain.ts");
  if (!existsSync(chainPath)) {
    throw new JobUsageError(
      `no chain at ${chainPath}; a job that could never \`run\` must not be creatable`,
    );
  }
  const { default: chain } = await loadChainModule(chainPath);

  // 3. Validate a declared seedDir before touching the state root — a
  // declared-but-absent seedDir must not leave a stray empty job dir behind.
  let seedPath: string | undefined;
  if (chain.seedDir !== undefined) {
    seedPath = resolve(configDir, chain.seedDir);
    if (!existsSync(seedPath)) {
      throw new JobUsageError(
        `chain declares seedDir '${chain.seedDir}' but ${seedPath} does not exist`,
      );
    }
  }

  // 4. Seed the state root — configDir-relative, verbatim copy,
  // skip-existing (v0.6 §4): re-run fills gaps (a stub added to the seed
  // dir reaches existing jobs) and never clobbers a worked file. Absent
  // seedDir → bare job; state accretes from ticks, no warning.
  const jobDir = join(repoRoot, ".flume", "jobs", name);
  await mkdir(jobDir, { recursive: true });
  if (seedPath !== undefined) {
    await cp(seedPath, jobDir, { recursive: true, force: false });
    log(`[flume] seeded ${jobDir} from ${seedPath}`);
  }

  // 5. Runtime ignores — written before the baseline add so runtime state
  // and the link below never enter the commit. A declared Chain.friction
  // dir folds into the same set (§3): gitignored by machinery, not by
  // per-repo habit.
  await ensureRuntimeIgnores(
    jobDir,
    chain.friction !== undefined ? [frictionIgnoreEntry(chain.friction)] : [],
  );

  // 6. Unconditional provisioning (§5a-4, resolved decision 5).
  await ensureFlumeLink(jobDir, opts.linkTarget ?? resolve(HERE, ".."));

  // 7. Job dirs nest deep; spare the operator MAX_PATH failures up front.
  if (process.platform === "win32") {
    await git(repoRoot, ["config", "core.longpaths", "true"]);
  }

  // 8. Baseline-commit the seeded harness so plan/build produce clean deltas.
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
  // 9. Stay on job/<name> — tune, then `flume job run`.
}

export interface JobRunOptions {
  repoRoot: string;
  name: string;
  /** Job state root — where the baton lives (resolved by the CLI, §3). */
  flumeDir: string;
  /**
   * Chain+prompts dir — repo-resident (v0.6 §2), never the job dir; arrives
   * already resolved from the CLI (`<repoRoot>/.flume` or explicit
   * `FLUME_CONFIG_DIR`).
   */
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

  // 2. Wake the entry phase iff hibernating. The chain is repo-resident
  // (`<configDir>/chain.ts`, v0.6 §2) and loads AFTER the checkout — the
  // checkout decides which branch's copy of the repo chain is on disk.
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

/**
 * The pid recorded in `<jobDir>/loop.pid`, when it names a live process —
 * `null` for no pidfile, an unparsable one, or a dead/not-ours pid (stale;
 * callers reclaim silently). Same liveness probe as the loop lock.
 */
async function liveLoopPid(jobDir: string): Promise<number | null> {
  const pidPath = join(jobDir, "loop.pid");
  if (!existsSync(pidPath)) return null;
  const pid = Number((await readFile(pidPath, "utf8")).trim());
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/**
 * Path of the worktree that has `branch` checked out, probed via
 * `git worktree list --porcelain`; `null` when none holds it. Git permits at
 * most one holder, so the first hit is the only one.
 */
async function worktreeHolding(
  cwd: string,
  branch: string,
): Promise<string | null> {
  const porcelain = await git(cwd, ["worktree", "list", "--porcelain"]);
  let path: string | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
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
  const livePid = await liveLoopPid(jobDir);
  if (livePid !== null) {
    throw new Error(
      `job '${name}' has a live loop (pid ${livePid}); stop it before \`flume job rm\``,
    );
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

/** One row of `flume job status` (v0.5 §5d). */
export interface JobStatus {
  /** Job name — the directory segment under `.flume/jobs/`. */
  name: string;
  /** Awake phases from the job's baton, sorted; empty means hibernating. */
  awake: string[];
  /**
   * Entry count from `<jobdir>/plan/pending.json`: 0 when the file is absent
   * (nothing planned is nothing pending), `null` when it exists but does not
   * parse — surfaced, not thrown, so one broken plan never hides the others.
   */
  pending: number | null;
  /**
   * Files under the job's declared friction dir (§6, v0.6.2), counted when
   * the caller supplies `frictionDir` (the repo chain's `Chain.friction`,
   * job-dir-relative — `jobStatus` has no chain of its own to load, so the
   * caller resolves it once and passes it in). `undefined` when no
   * `frictionDir` is given.
   */
  frictionCount?: number;
}

/** Files (not subdirs) directly under `dir`; 0 when `dir` is absent or unreadable. */
function countFrictionFiles(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
      .length;
  } catch {
    return 0;
  }
}

/**
 * `flume job status` (v0.5 §5d): enumerate `.flume/jobs/*` in the working
 * tree — awake phases + pending count per job. Observational: reads only
 * what exists and writes nothing. The Baton constructor mkdirs `awake/`, so
 * it is constructed only when that dir is already on disk (mkdir on an
 * existing dir is a no-op); non-directories under `jobs/` are skipped.
 *
 * `frictionDir` (§6, v0.6.2), when supplied, is the repo chain's declared
 * `Chain.friction` — job-dir-relative, so the same string applies to every
 * job. Omitted → every row's `frictionCount` is `undefined`.
 */
export function jobStatus(repoRoot: string, frictionDir?: string): JobStatus[] {
  const jobsRoot = join(repoRoot, ".flume", "jobs");
  if (!existsSync(jobsRoot)) return [];
  return readdirSync(jobsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const jobDir = join(jobsRoot, name);
      const awake = existsSync(join(jobDir, "awake"))
        ? new Baton(jobDir).awake()
        : [];
      const pendingPath = join(jobDir, "plan", "pending.json");
      let pending: number | null = 0;
      if (existsSync(pendingPath)) {
        const parsed = parsePending(readFileSync(pendingPath, "utf8"));
        pending = parsed.ok ? parsed.entries.length : null;
      }
      const frictionCount =
        frictionDir !== undefined
          ? countFrictionFiles(join(jobDir, frictionDir))
          : undefined;
      return {
        name,
        awake,
        pending,
        ...(frictionCount !== undefined ? { frictionCount } : {}),
      };
    });
}

/** Blob content at `<ref>:<path>`, raw and untrimmed; `null` when absent. */
async function gitShowBlob(cwd: string, spec: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["show", spec], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Files directly under `dir`, name-sorted with content — off the working
 * tree (§6, v0.6.2: friction is gitignored, so git show can never see it).
 * `[]` when `dir` is absent or unreadable — a channel nothing has written to
 * yet is not an error.
 */
function readFrictionFiles(dir: string): { name: string; content: string }[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return names.map((fname) => ({
    name: fname,
    content: readFileSync(join(dir, fname), "utf8"),
  }));
}

export interface JobExtractOptions {
  repoRoot: string;
  name: string;
  /** Base the clean branch forks from (§5e: required, never guessed). */
  onto: string;
  /**
   * Chain+prompts dir — repo-resident (v0.6 §2); defaults to
   * `<repoRoot>/.flume`. Extract loads the chain from here for its
   * declared `harvest` list (§5) and `friction` dir (§6).
   */
  configDir?: string;
  /** Intake pass-through files, repo-relative (§5e-2). */
  intake?: string[];
  log?: (line: string) => void;
}

/** What {@link jobExtract} hands back for operator routing. */
export interface JobExtractResult {
  /** Cherry-picked commit count (the intake commit is not one of them). */
  picked: number;
  /** True when the intake pass-through carried a real delta (one commit). */
  intakeCommitted: boolean;
  /**
   * Harvested prose: each chain-declared `harvest` (v0.6 §5) entry → content
   * off the job branch tip (git show, not worktree — §5e-4), `null` when
   * absent, followed — when `Chain.friction` is declared (§6, v0.6.2) — by
   * one entry per file in the declared friction dir, read off the job dir's
   * *working tree* instead of git show: friction is gitignored by design and
   * so never reaches a commit; git show can only ever see it as absent. This
   * replaces the legacy per-chain convention of listing a fixed
   * `"friction.md"` in `harvest`, which could only ever resolve to `null`.
   * Empty when the chain declares neither `harvest` nor `friction`.
   */
  harvest: { path: string; content: string | null }[];
}

/**
 * `flume job extract <name> --onto <base> [--intake <path>]...` (v0.5 §5e,
 * harvest chain-declared per v0.6 §5 and, for friction, v0.6.2 §6) — the
 * clean-history ending, for deliverables where harness commits must never
 * appear and squash rights are absent. Load the chain's `harvest` list and
 * `friction` declaration, fork `<name>` off `--onto`, ship the intake
 * pass-through as one commit, cherry-pick the non-harness commits
 * oldest-first, harvest the declared `harvest` paths plus the declared
 * friction dir's files, then consume the job: branch `job/<name>` and the
 * harness dir both go.
 *
 * On any failure after the fork the partial branch is unwound (§5e-3):
 * in-flight pick aborted, checkout back on `job/<name>`, partial branch
 * deleted — extract is retryable, nothing lost.
 *
 * Throws {@link JobUsageError} on a bad name, a job whose branch does not
 * exist, an unresolvable `--onto`, or a missing `<configDir>/chain.ts`
 * (exit 2 at the CLI); refusals over repo state (clobber, dirty tree, live
 * loop, `job/<name>` held by another worktree) and git failures are
 * operational errors (exit 1).
 */
export async function jobExtract(
  opts: JobExtractOptions,
): Promise<JobExtractResult> {
  const { repoRoot, name, onto } = opts;
  const configDir = opts.configDir ?? join(repoRoot, ".flume");
  const log = opts.log ?? ((line: string) => console.log(line));
  // Git pathspecs are forward-slash regardless of host.
  const intake = (opts.intake ?? []).map((p) => p.replace(/\\/g, "/"));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);
  const jobBranch = `job/${name}`;
  const relPosix = `.flume/jobs/${name}`;
  const jobDir = join(repoRoot, ".flume", "jobs", name);

  if (!(await branchExists(repoRoot, jobBranch))) {
    throw new JobUsageError(
      `no job '${name}': branch ${jobBranch} does not exist`,
    );
  }
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${onto}^{commit}`]);
  } catch {
    throw new JobUsageError(`--onto '${onto}' does not resolve to a commit`);
  }

  // Load the chain's declared harvest list before any mutation (v0.6 §5) —
  // a load failure must leave the job untouched, same as the checks above.
  // No ordering hazard: the repo chain is configDir-resident, not job-dir,
  // so it survives job consumption regardless of when it's read. Mirrors
  // jobNew's chainPath guard: a missing chain is usage-shaped, not
  // operational — the residency invariant (v0.6 §2) guarantees a chain
  // exists, so its absence means the caller pointed extract at the wrong
  // configDir.
  const chainPath = resolve(configDir, "chain.ts");
  if (!existsSync(chainPath)) {
    throw new JobUsageError(`no chain at ${chainPath}`);
  }
  const { default: chain } = await loadChainModule(chainPath);
  const harvestPaths = chain.harvest ?? [];

  // 1. No clobber (§5e-1): the clean branch is named by the job, and a
  // pre-existing branch of that name is someone's work.
  if (await branchExists(repoRoot, name)) {
    throw new Error(
      `branch '${name}' already exists; refusing to clobber — integrate or delete it, then retry \`flume job extract\``,
    );
  }

  // Extract rewrites the checkout (fork, cherry-pick, unwind): tracked
  // modifications in flight would ride across branches or torpedo the
  // unwind, so refuse up front. Untracked files pass through harmlessly.
  const dirtyTracked = await git(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (dirtyTracked.length > 0) {
    throw new Error(
      `working tree has uncommitted tracked changes; commit or stash before \`flume job extract\``,
    );
  }

  // Mirror §5c-1: consuming a job out from under its live loop strands the
  // supervisor mid-tick — extract is strictly more destructive than rm.
  const livePid = await liveLoopPid(jobDir);
  if (livePid !== null) {
    throw new Error(
      `job '${name}' has a live loop (pid ${livePid}); stop it before \`flume job extract\``,
    );
  }

  // §6-recipe jobs hit this routinely: the recipe worktree keeps job/<name>
  // checked out after its loop stops, and `git branch -D` at consume (step
  // 5) refuses branches checked out anywhere — it would fail AFTER the
  // picks, losing the harvest and stranding the clean branch. Refuse up
  // front instead. The current worktree is exempt: extract itself moves it
  // off the branch, and git permits one holder — HEAD == job/<name> here
  // means no other worktree has it.
  const head = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head !== jobBranch) {
    const holder = await worktreeHolding(repoRoot, jobBranch);
    if (holder !== null) {
      throw new Error(
        `branch ${jobBranch} is checked out in another worktree (${holder}); ` +
          `\`git worktree remove\` it — or run extract from inside it — before \`flume job extract\``,
      );
    }
  }

  // 2. Fork off --onto.
  await git(repoRoot, ["checkout", "-q", "-b", name, onto]);
  log(`[flume] forked '${name}' off ${onto}`);

  let intakeCommitted = false;
  let picked = 0;
  try {
    // Intake pass-through first (§5e-2): each file synced byte-exact to its
    // job-branch-tip state, the whole delta shipped as ONE commit before any
    // cherry-pick — so a pick that also grew an intake file (plan-side
    // appends) lands against final content instead of conflicting.
    for (const p of intake) {
      let atTip = true;
      try {
        await git(repoRoot, ["cat-file", "-e", `${jobBranch}:${p}`]);
      } catch {
        atTip = false;
      }
      if (atTip) {
        // Stages worktree AND index from the tip — no separate add needed.
        await git(repoRoot, ["checkout", "-q", jobBranch, "--", p]);
      } else {
        // Absent at the tip: sync means the fork must not carry it either.
        await git(repoRoot, ["rm", "-q", "--ignore-unmatch", "--", p]);
      }
    }
    if (intake.length > 0) {
      const staged = await git(repoRoot, [
        "status",
        "--porcelain",
        "--",
        ...intake,
      ]);
      if (staged.length > 0) {
        await git(repoRoot, [
          "commit",
          "-q",
          "-m",
          `intake: pass-through from ${jobBranch}`,
          "--",
          ...intake,
        ]);
        intakeCommitted = true;
        log(`[flume] intake pass-through: ${intake.join(", ")} (1 commit)`);
      } else {
        log(`[flume] intake already in sync with ${jobBranch}; no commit`);
      }
    }

    // Oldest-first selection (§5e-2): commits unique to the job branch that
    // touch any path outside the harness dir and outside the intake set.
    // Exclude-only pathspecs match everything else; a mixed commit (harness
    // + code) is selected and picked whole.
    const excludes = [relPosix, ...intake].map((p) => `:(exclude)${p}`);
    const listed = await git(repoRoot, [
      "rev-list",
      "--reverse",
      `${onto}..${jobBranch}`,
      "--",
      ...excludes,
    ]);
    const picks = listed.length > 0 ? listed.split("\n") : [];
    for (const sha of picks) {
      await git(repoRoot, ["cherry-pick", sha]);
      picked += 1;
    }
    log(`[flume] cherry-picked ${picked} commit(s) from ${jobBranch}`);
  } catch (err) {
    // 3. Unwind (§5e-3): abort any in-flight pick, return to the job
    // branch, drop the partial clean branch. The job is untouched.
    try {
      await git(repoRoot, ["cherry-pick", "--abort"]);
    } catch {
      // no cherry-pick in progress — the failure was elsewhere
    }
    await git(repoRoot, ["checkout", "-q", jobBranch]);
    await git(repoRoot, ["branch", "-q", "-D", name]);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `extract of '${name}' unwound to ${jobBranch} (partial branch deleted; the job is intact — extract is retryable): ${msg}`,
    );
  }

  // 4. Harvest off the job branch (git show, not worktree — the working
  // tree is on the clean branch by now), before the branch is consumed.
  const harvest: { path: string; content: string | null }[] = [];
  for (const p of harvestPaths) {
    harvest.push({
      path: p,
      content: await gitShowBlob(repoRoot, `${jobBranch}:${relPosix}/${p}`),
    });
  }
  // Friction (§6, v0.6.2): gitignored, so it never reaches a commit — read
  // it off jobDir's actual working tree instead, before step 5 removes it.
  // The checkout in step 2 left jobDir's tracked files gone (the clean
  // branch doesn't track them) but its gitignored friction/ subdirectory
  // untouched, exactly as teardown harvest (§4) relies on for worktrees.
  if (chain.friction !== undefined) {
    for (const f of readFrictionFiles(join(jobDir, chain.friction))) {
      harvest.push({ path: `${chain.friction}/${f.name}`, content: f.content });
    }
  }

  // 5. Extract consumes the job (§5e-5). The harness dir now holds only
  // ignored runtime remnants — the checkout off the job branch removed the
  // tracked files; fs.rm unlinks the @dtmd/flume junction without following
  // it. Prune afterward for the same reason rm does (§5c-4): the dir held
  // the job's fanout worktrees.
  await git(repoRoot, ["branch", "-q", "-D", jobBranch]);
  await rm(jobDir, { recursive: true, force: true });
  await git(repoRoot, ["worktree", "prune"]);
  log(
    `[flume] consumed job '${name}': branch ${jobBranch} and ${relPosix} removed; HEAD on '${name}'`,
  );

  return { picked, intakeCommitted, harvest };
}
