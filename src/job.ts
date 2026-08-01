/**
 * `flume job` — lifecycle verbs over a job (v0.5 §5, branch grammar retired
 * v0.11 §2/§3): a job is `.flume/jobs/<name>/` — tracked files in the
 * working tree, on whatever branch the operator is on. Nothing more.
 * Machinery only: no presets, no encoded checks, no harness content —
 * content arrives via the repo chain's `Chain.seedDir` (v0.6 §4),
 * chain-owned. `new`/`run`/`rm` construct, assert, and checkout no branch.
 * The clean-history ending (`extract`) is removed (v0.11 §3) — a side
 * branch plus ordinary git is the operator's recipe now, documented in
 * `docs/MIGRATING-0.11.md`.
 *
 * `src/cli.ts` routes `flume job <verb>` here. Git access is a local thin
 * wrapper: the verbs speak porcelain (`add`, `commit`, `rm`, `config`), a
 * different surface from `src/git.ts`'s dispatcher plumbing.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

import { Baton } from "./Baton.js";
import { loadChainModule } from "./Dispatcher.js";
import { pinLongPaths } from "./git.js";
import { parsePendingLoose } from "./PendingSchema.js";
import type { ParseResult } from "./PendingSchema.js";

const exec = promisify(execFile);

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
  log?: (line: string) => void;
}

/**
 * `flume job new <name>` (v0.6 §4; branch grammar retired, v0.11 §2/§3).
 * Load the repo chain — no `<configDir>/chain.ts` is a usage error, since a
 * job that could never `run` must not be creatable — then copy its declared
 * `seedDir` into `.flume/jobs/<name>/` verbatim, skip-existing (a
 * declared-but-absent `seedDir` is the same class of usage error; an
 * undeclared `seedDir` seeds nothing, no warning), ensure runtime ignores,
 * pin `core.longpaths` (win32), baseline-commit the harness on the current
 * HEAD. No branch is created or checked out — HEAD stays wherever the
 * operator left it. Idempotent on re-run. `import "@dtmd/flume"` from a job
 * chain resolves via the bay's own install — no per-job link is provisioned
 * (v0.9 §3).
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

  // 1. Load the repo chain. The residency invariant (v0.6 §2) guarantees a
  // chain exists before any job does; a chainless repo cannot run the job
  // it would create.
  const chainPath = resolve(configDir, "chain.ts");
  if (!existsSync(chainPath)) {
    throw new JobUsageError(
      `no chain at ${chainPath}; a job that could never \`run\` must not be creatable`,
    );
  }
  const { default: chain } = await loadChainModule(chainPath);

  // 2. Validate a declared seedDir before touching the state root — a
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

  // 3. Seed the state root — configDir-relative, verbatim copy,
  // skip-existing (v0.6 §4): re-run fills gaps (a stub added to the seed
  // dir reaches existing jobs) and never clobbers a worked file. Absent
  // seedDir → bare job; state accretes from ticks, no warning.
  const jobDir = join(repoRoot, ".flume", "jobs", name);
  await mkdir(jobDir, { recursive: true });
  if (seedPath !== undefined) {
    await cp(seedPath, jobDir, { recursive: true, force: false });
    log(`[flume] seeded ${jobDir} from ${seedPath}`);
  }

  // 4. Runtime ignores — written before the baseline add so runtime state
  // never enters the commit. A declared Chain.friction dir folds into the
  // same set (§3): gitignored by machinery, not by per-repo habit.
  await ensureRuntimeIgnores(
    jobDir,
    chain.friction !== undefined ? [frictionIgnoreEntry(chain.friction)] : [],
  );

  // 5. Job dirs nest deep; spare the operator MAX_PATH failures up front.
  await pinLongPaths(repoRoot);

  // 6. Baseline-commit the seeded harness on the current HEAD so plan/build
  // produce clean deltas. The commit is pathspec-scoped: anything the
  // operator pre-staged outside the job dir stays in the index instead of
  // being swept into the seed.
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
    log(`[flume] baseline commit on current HEAD`);
  } else {
    log(`[flume] harness already baselined; nothing to commit`);
  }
}

export interface JobRunOptions {
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
 * `flume job run <name>` preflight (v0.11 §2/§3): wake the chain's entry
 * phase — `chain.phases[0]`, a content-free convention (decision 6, no
 * hardcoded phase names) — iff the baton is hibernating. A non-hibernating
 * baton is left untouched (mid-job resume). No branch is asserted or
 * checked out — the engine has no opinion on which branch a state root
 * runs on. The loop itself (§5b-3) is the CLI's standard `flume loop` path
 * under the job resolution; this function owns only the wake step before it.
 *
 * Throws {@link JobUsageError} on a bad name (exit 2 at the CLI); any other
 * throw is an operational failure (exit 1).
 */
export async function jobRun(opts: JobRunOptions): Promise<void> {
  const { name, flumeDir, configDir } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);

  // Wake the entry phase iff hibernating. The chain is repo-resident
  // (`<configDir>/chain.ts`, v0.6 §2).
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
 * The pid recorded in `<dir>/loop.pid`, when it names a live process —
 * `null` for no pidfile, an unparsable one, or a dead/not-ours pid (stale;
 * callers reclaim silently). Same liveness probe as the loop lock. Exported
 * for reuse (`flume status`'s supervisor-liveness probe, v0.7 §17) rather
 * than a second implementation of the same pid-liveness check.
 */
export async function liveLoopPid(dir: string): Promise<number | null> {
  const pidPath = join(dir, "loop.pid");
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

export interface JobRmOptions {
  repoRoot: string;
  name: string;
  log?: (line: string) => void;
}

/**
 * `flume job rm <name>` (v0.5 §5c; branch grammar retired, v0.11 §2/§3) —
 * the discard ending: throw the harness away, keep the work. Refuse while
 * the job's `loop.pid` records a live pid; `git rm -r` the tracked harness
 * plus a cleanup commit on the current HEAD; remove untracked runtime
 * remnants; `git worktree prune`. No branch is checked out or touched — the
 * operator's branches are never rm's business.
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

  const jobDir = join(repoRoot, ".flume", "jobs", name);
  const rel = join(".flume", "jobs", name);
  if (!existsSync(jobDir)) {
    throw new JobUsageError(`no job '${name}': ${rel} does not exist`);
  }

  // 1. Refuse while the loop is live — removing the state root out from
  // under a running supervisor would strand its ticks.
  const livePid = await liveLoopPid(jobDir);
  if (livePid !== null) {
    throw new Error(
      `job '${name}' has a live loop (pid ${livePid}); stop it before \`flume job rm\``,
    );
  }

  // 2. Cleanup commit on the current HEAD.
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
    log(`[flume] cleanup commit on current HEAD`);
  } else {
    log(`[flume] no tracked harness under ${rel}; nothing to commit`);
  }

  // 3. Untracked runtime remnants (awake/, prior-attempts/, pid files, and
  // any stale @dtmd/flume link left by a pre-0.9 job dir) — the ignore
  // entries kept them out of git, so git rm left them behind. fs.rm unlinks
  // a stale junction/symlink without following it; the link target is never
  // touched.
  await rm(jobDir, { recursive: true, force: true });

  // 4. Stale metadata from the job's fanout worktrees.
  await git(repoRoot, ["worktree", "prune"]);
  log(`[flume] removed ${rel}`);
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
    // win32 total-path limit (~260 chars, v0.4 §6): dir joins a job dir
    // onto chain.friction, the same construction writeRevertNote and
    // harvestFriction guard in Dispatcher.ts. toNamespacedPath prepends the
    // \\?\ extended-length prefix on win32 (no-op elsewhere).
    return readdirSync(toNamespacedPath(dir), { withFileTypes: true })
      .filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * Chain-less informational read of a pending.json at `pendingPath`: absent
 * reads as the empty, valid list (nothing planned is nothing pending);
 * present reads through `parsePendingLoose` (core fields validated, no
 * extension composed — never a write path). The one probe `flume status`
 * and `flume job status` (`src/cli.ts`) both call, so a corrupt file reads
 * "unparsable" identically on either surface.
 */
export function readPendingLoose(pendingPath: string): ParseResult {
  if (!existsSync(pendingPath)) return { ok: true, entries: [], errors: [] };
  return parsePendingLoose(readFileSync(pendingPath, "utf8"));
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
      const parsed = readPendingLoose(join(jobDir, "plan", "pending.json"));
      const pending = parsed.ok ? parsed.entries.length : null;
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
