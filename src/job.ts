/**
 * `flume job` — lifecycle verbs over a job: a job is `.flume/jobs/<name>/` —
 * tracked files in the working tree, on whatever branch the operator is on.
 * Nothing more. Machinery only: no presets, no encoded checks, no harness
 * content — content arrives via the repo chain's `Chain.seedDir`, chain-owned.
 * `new`/`run`/`rm` construct, assert, and checkout no branch. There is no
 * clean-history ending: a side branch plus ordinary git is the operator's
 * recipe, documented in `docs/MIGRATING-0.10.md` § 5.
 *
 * `src/cli.ts` routes `flume job <verb>` here. Git access is a local thin
 * wrapper: the verbs speak porcelain (`add`, `commit`, `rm`, `config`), a
 * different surface from `src/git.ts`'s dispatcher plumbing.
 */

import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Baton } from "./Baton.js";
import { loadChainModule } from "./Dispatcher.js";
import { existsLoud } from "./fsProbe.js";
import { literalPathspecEnv, pinLongPaths } from "./git.js";
import {
  awakeDir,
  chainModulePath,
  defaultStateRoot,
  gitPath,
  jobDir,
  jobDirRel,
  jobsRoot,
  loopLockPath,
  namespacedJoin,
  resolvePendingPath,
  STATE_ROOT_NAMES,
} from "./paths.js";
import { parsePendingLoose } from "./PendingSchema.js";
import type { ParseResult } from "./PendingSchema.js";

const exec = promisify(execFile);

/** Usage-shaped failure (bad name, missing template): the CLI maps it to exit 2. */
export class JobUsageError extends Error {}

/**
 * Runtime-owned entries ensured in every job dir's `.gitignore`. The runtime
 * owns its layout; chain-convention dirs (`sessions/`) are the template's to
 * add.
 *
 * Derived from `STATE_ROOT_NAMES` (`src/paths.ts`) wherever an accessor owns
 * the name, so renaming a runtime path cannot leave the ignore behind
 * pointing at the old one. `node_modules/` is not the runtime's to name, so
 * it stays spelled here.
 *
 * `worktrees/` is the default base alone (`worktreesBase`, `src/paths.ts`):
 * a base relocated by the operator (`FLUME_WORKTREES_DIR`) or by the chain
 * (`Chain.worktreesBase`) has already moved outside the job dir, so there is
 * nothing under this `.gitignore` to ignore.
 */
export const RUNTIME_IGNORES = [
  `${STATE_ROOT_NAMES.awake}/`,
  `${STATE_ROOT_NAMES.priorAttempts}/`,
  `${STATE_ROOT_NAMES.renderedPrompts}/`,
  `${STATE_ROOT_NAMES.worktrees}/`,
  `${STATE_ROOT_NAMES.merging}/`,
  "node_modules/",
  STATE_ROOT_NAMES.loopLock,
  STATE_ROOT_NAMES.tickVerdict,
  STATE_ROOT_NAMES.tickVerdictsLog,
  STATE_ROOT_NAMES.stopFlag,
] as const;

/**
 * A job name must be usable verbatim as one path segment
 * (`.flume/jobs/<name>`) and one branch segment (`job/<name>`) — reject
 * anything that would escape either construction, before any dir or branch
 * is built. Returns the rejection reason, or `null` for a valid name.
 * (The creating verb is where shape is enforced; `--job` resolution in
 * `resolveStateDirs` (`src/cliJobResolution.ts`) composes the flag straight into
 * `.flume/jobs/<name>` without routing through this check.)
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

/**
 * The verbs' porcelain wrapper — a different surface from `src/git.ts`'s
 * dispatcher plumbing, under the same pathspec dialect
 * ({@link literalPathspecEnv}). Every pathspec these verbs pass is
 * {@link jobDirPathspec}, composed from a name an operator chose, and
 * `validateJobName` admits the glob metacharacters: read as a pattern, `a*`
 * names sibling job `ab` as well as itself, which `add`/`commit` sweep into
 * one job's commit and `rm -r` deletes outright.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      env: literalPathspecEnv(),
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
 * A job's dir as a **pathspec** — `.flume/jobs/<name>`, repo-relative and in
 * the forward-slash alphabet git names every path with on every platform
 * ({@link gitPath}, `src/paths.ts`). The one derivation the verbs' `add`,
 * `status`, `commit`, `ls-files` and `rm` all take their pathspec from.
 *
 * {@link jobDirRel} (`src/paths.ts`) composes it in the *host's* alphabet:
 * on win32 that is `.flume\jobs\<name>`, and under {@link literalPathspecEnv}
 * git compares that byte-for-byte against paths it spells with `/`, so it
 * selects nothing.
 * Every verb then acts on the empty set without saying so — `job new` reports
 * "already baselined" over a job it just seeded, and `job rm` logs "no
 * tracked harness", leaves the harness committed, and removes the dir anyway.
 * Folding the engine's one host-to-git rule over the composition is what
 * keeps these pathspecs in git's alphabet rather than the host's
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * The verbs report this same string to the operator, so a log line and the
 * pathspec behind it cannot name the dir differently.
 */
function jobDirPathspec(name: string): string {
  return gitPath(jobDirRel(name));
}

/**
 * Merge `lines` into the `.gitignore` at `path`: create the file if absent,
 * append only the entries it does not already carry otherwise. Returns the
 * lines appended, empty when the file already held every one. Idempotent;
 * hand-authored lines (and their order) are preserved verbatim.
 *
 * **One home, two adopters.** {@link ensureRuntimeIgnores} merges the runtime
 * set into a job's state root, and `flume-harness init` (`harness/init.ts`)
 * merges the consumer-prefixed set into a repository's root `.gitignore`.
 * The merge is the same detection either way, and a second spelling is how
 * one caller comes to duplicate a line the other deduped
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export async function mergeIgnoreLines(
  path: string,
  lines: readonly string[],
): Promise<string[]> {
  // Absent (`ENOENT`) is the empty file: nothing authored, nothing to merge
  // into. Any other read failure rethrows rather than reading as empty — an
  // unreadable `.gitignore` treated as "" would be rewritten with the merged
  // set alone, dropping the hand-authored lines this function exists to
  // preserve (`.claude/rules/engineering.md`, "Loud or nothing").
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    existing = "";
  }
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((entry) => !have.has(entry));
  if (missing.length === 0) return [];
  const base =
    existing.length === 0 || existing.endsWith("\n") ? existing : existing + "\n";
  await writeFile(path, base + missing.join("\n") + "\n", "utf8");
  return missing;
}

/**
 * Merge {@link RUNTIME_IGNORES} — plus any caller-supplied `extra` entries (a
 * declared `Chain.friction` dir) — into `<stateRoot>/.gitignore`.
 */
export async function ensureRuntimeIgnores(
  stateRoot: string,
  extra: readonly string[] = [],
): Promise<void> {
  // win32 MAX_PATH (`.claude/rules/platform-facts.md`): a job's state root
  // nests under the bay, so `.gitignore` under it can cross the total-path
  // limit even though no single component is long. namespacedJoin
  // (src/paths.ts) is the shared idiom.
  await mergeIgnoreLines(namespacedJoin(stateRoot, ".gitignore"), [
    ...RUNTIME_IGNORES,
    ...extra,
  ]);
}

/**
 * `<friction>/` as it belongs in `.gitignore` — forward-slashed and
 * single-trailing-slashed regardless of how the chain wrote the declaration
 * (`Chain.friction` is validated relative at load time; this only shapes it
 * for the ignore line).
 *
 * Exported so every state root that merges the runtime set spells the
 * friction entry the same way: `job new` here, and the `loop` / `job run`
 * start against the default root (`src/cli.ts`). Re-spelling the
 * normalization at the second caller would be re-derived detection
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export function frictionIgnoreEntry(friction: string): string {
  return `${gitPath(friction).replace(/\/+$/, "")}/`;
}

export interface JobNewOptions {
  repoRoot: string;
  name: string;
  /**
   * Chain + prompts dir the repo chain (and a declared `Chain.seedDir`)
   * resolve against — repo-resident, never the job dir. Defaults to
   * `<repoRoot>/.flume`, the same default the CLI resolves absent an explicit
   * `FLUME_CONFIG_DIR`.
   */
  configDir?: string;
  /**
   * State root the chain this verb loads is told to resolve per-run
   * artifacts against (`FlumeApi.paths.flumeDir`). Defaults to
   * `<repoRoot>/.flume`, the same default `configDir` takes and the same one
   * the CLI resolves absent `FLUME_DIR`/`--job`; the CLI always passes its
   * own `resolveStateDirs` answer explicitly.
   */
  flumeDir?: string;
  log?: (line: string) => void;
  /**
   * Override for the seed commit's message (engine-boundary.md "Capability
   * vs convention"). Called with the job name; `jobNew` commits with
   * whatever string it returns. The `chore(flume): seed job ...` wording is
   * this harness's own convention, not something every chain need adopt.
   * Default (omitted): reproduces that exact text.
   */
  commitMessage?: (name: string) => string;
}

/**
 * `flume job new <name>`. Load the repo chain — no `<configDir>/chain.ts` is a
 * usage error, since a job that could never `run` must not be creatable — then
 * copy its declared `seedDir` into `.flume/jobs/<name>/` verbatim,
 * skip-existing (a declared-but-absent `seedDir` is the same class of usage
 * error; an undeclared `seedDir` seeds nothing, no warning), ensure runtime
 * ignores, pin `core.longpaths` (win32), baseline-commit the harness on the
 * current HEAD. No branch is created or checked out — HEAD stays wherever the
 * operator left it. Idempotent on re-run. `import "@dtmd/flume"` from a job
 * chain resolves via the bay's own install — no per-job link is provisioned.
 *
 * Throws {@link JobUsageError} on usage-shaped input (exit 2 at the CLI);
 * any other throw is an operational failure (exit 1).
 */
export async function jobNew(opts: JobNewOptions): Promise<void> {
  const { repoRoot, name } = opts;
  const configDir = opts.configDir ?? defaultStateRoot(repoRoot);
  const flumeDir = opts.flumeDir ?? defaultStateRoot(repoRoot);
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);

  // 1. Load the repo chain. The residency invariant guarantees a chain exists
  // before any job does; a chainless repo cannot run the job it would create.
  // `chainModulePath` (src/paths.ts) is the one derivation of this path, the
  // same one `loadChainModule` resolves from the `configDir` handed to it two
  // lines below — the probe and the load cannot name different files.
  const chainPath = chainModulePath(configDir);
  // win32 MAX_PATH (`.claude/rules/platform-facts.md`): configDir can nest
  // deep enough that the total path crosses the limit with no single
  // component long; namespacedJoin (src/paths.ts) is the shared idiom.
  if (!existsLoud(namespacedJoin(chainPath))) {
    throw new JobUsageError(
      `no chain at ${chainPath}; a job that could never \`run\` must not be creatable`,
    );
  }
  const { chain } = await loadChainModule({ repoRoot, configDir, flumeDir });

  // 2. Validate a declared seedDir before touching the state root — a
  // declared-but-absent seedDir must not leave a stray empty job dir behind.
  let seedPath: string | undefined;
  if (chain.seedDir !== undefined) {
    seedPath = resolve(configDir, chain.seedDir);
    if (!existsLoud(namespacedJoin(seedPath))) {
      throw new JobUsageError(
        `chain declares seedDir '${chain.seedDir}' but ${seedPath} does not exist`,
      );
    }
  }

  // 3. Seed the state root — configDir-relative, verbatim copy, skip-existing:
  // re-run fills gaps (a stub added to the seed dir reaches existing jobs) and
  // never clobbers a worked file. Absent seedDir → bare job; state accretes
  // from ticks, no warning.
  const dir = jobDir(repoRoot, name);
  // win32 MAX_PATH: the job dir nests under the state root; namespacedJoin
  // (src/paths.ts) is the shared idiom for every fs call built from it.
  await mkdir(namespacedJoin(dir), { recursive: true });
  if (seedPath !== undefined) {
    await cp(namespacedJoin(seedPath), namespacedJoin(dir), {
      recursive: true,
      force: false,
    });
    log(`[flume] seeded ${dir} from ${seedPath}`);
  }

  // 4. Runtime ignores — written before the baseline add so runtime state
  // never enters the commit. A declared Chain.friction dir folds into the same
  // set: gitignored by machinery, not by per-repo habit.
  await ensureRuntimeIgnores(
    dir,
    chain.friction !== undefined ? [frictionIgnoreEntry(chain.friction)] : [],
  );

  // 5. Job dirs nest deep; spare the operator MAX_PATH failures up front.
  await pinLongPaths(repoRoot);

  // 6. Baseline-commit the seeded harness on the current HEAD so plan/build
  // produce clean deltas. The commit is pathspec-scoped: anything the
  // operator pre-staged outside the job dir stays in the index instead of
  // being swept into the seed.
  const rel = jobDirPathspec(name);
  await git(repoRoot, ["add", "--", rel]);
  const staged = await git(repoRoot, ["status", "--porcelain", "--", rel]);
  if (staged.length > 0) {
    const message = opts.commitMessage?.(name) ?? `chore(flume): seed job ${name}`;
    await git(repoRoot, ["commit", "-q", "-m", message, "--", rel]);
    log(`[flume] baseline commit on current HEAD`);
  } else {
    log(`[flume] harness already baselined; nothing to commit`);
  }

  // Next-step pointer: a fresh job's first tick otherwise greets the
  // operator with "no phases awake; hibernating" (job run wakes the entry
  // phase, above) — name the command that actually starts it.
  log(`[flume] next: flume job run ${name}`);
}

export interface JobRunOptions {
  name: string;
  /** Primary repo root — one leg of the roots the chain factory receives. */
  repoRoot: string;
  /** Job state root — where the baton lives (resolved by the CLI). */
  flumeDir: string;
  /**
   * Chain+prompts dir — repo-resident, never the job dir; arrives already
   * resolved from the CLI (`<repoRoot>/.flume` or explicit
   * `FLUME_CONFIG_DIR`).
   */
  configDir: string;
  log?: (line: string) => void;
}

/**
 * `flume job run <name>` preflight: wake the chain's entry phase —
 * `chain.phases[0]`, a content-free convention (decision 6, no hardcoded phase
 * names) — iff the baton is hibernating. A non-hibernating baton is left
 * untouched (mid-job resume). No branch is asserted or checked out — the
 * engine has no opinion on which branch a state root runs on. The loop itself
 * is the CLI's standard `flume loop` path under the job resolution; this
 * function owns only the wake step before it.
 *
 * Throws {@link JobUsageError} on a bad name (exit 2 at the CLI); any other
 * throw is an operational failure (exit 1).
 */
export async function jobRun(opts: JobRunOptions): Promise<void> {
  const { name, repoRoot, flumeDir, configDir } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));

  const invalid = validateJobName(name);
  if (invalid) throw new JobUsageError(invalid);

  // Wake the entry phase iff hibernating. The chain is repo-resident
  // (`<configDir>/chain.ts`).
  const baton = new Baton(flumeDir);
  if (!baton.hibernating()) {
    log(
      `[flume] baton awake (${baton.awake().join(", ")}); resuming mid-job, entry phase untouched`,
    );
    return;
  }
  const { chain } = await loadChainModule({ repoRoot, configDir, flumeDir });
  const entry = chain.phases[0];
  if (!entry) {
    throw new Error(`chain at ${configDir} declares no phases; nothing to wake`);
  }
  baton.wake(entry.name);
  log(`[flume] woke ${entry.name} (entry phase)`);
}

/**
 * The pid recorded in `<dir>/loop.pid`, when it names a live process — `null`
 * for no pidfile, an unparsable one, or a dead/not-ours pid (stale; callers
 * reclaim silently). Same liveness probe as the loop lock. Exported for reuse
 * (`flume status`'s supervisor-liveness probe) rather than a second
 * implementation of the same pid-liveness check.
 *
 * Absent (`ENOENT`) is the only no-pidfile reading; any other read failure
 * (permission denied, a path too long for the platform, …) throws
 * (`.claude/rules/engineering.md`, "Loud or nothing"). A `null` from an
 * unreadable pidfile would report a live loop as dead, which is exactly the
 * reading `jobRm`'s refusal and the `flume loop` lock claim exist to prevent.
 */
export async function liveLoopPid(dir: string): Promise<number | null> {
  // win32 MAX_PATH: dir is a job/state root that can nest deep; namespacedJoin
  // (src/paths.ts) is the shared idiom.
  const pidPath = namespacedJoin(loopLockPath(dir));
  let raw: string;
  try {
    raw = await readFile(pidPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const pid = Number(raw.trim());
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
  /**
   * Override for the cleanup commit's message (engine-boundary.md
   * "Capability vs convention"). Called with the job name; `jobRm` commits
   * with whatever string it returns. The `chore(flume): rm job ...` wording
   * is this harness's own convention, not something every chain need adopt.
   * Default (omitted): reproduces that exact text.
   */
  commitMessage?: (name: string) => string;
}

/**
 * `flume job rm <name>` — the discard ending: throw the harness away, keep the
 * work. Refuse while the job's `loop.pid` records a live pid; `git rm -r` the
 * tracked harness plus a cleanup commit on the current HEAD; remove untracked
 * runtime remnants; `git worktree prune`. No branch is checked out or touched
 * — the operator's branches are never rm's business.
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

  const dir = jobDir(repoRoot, name);
  const rel = jobDirPathspec(name);
  // Absent (`ENOENT`) is the only "no job" reading — an unreachable job dir
  // (permission denied, a path too long for the platform) throws rather than
  // reporting "no job" for one that exists. win32 MAX_PATH: namespacedJoin
  // (src/paths.ts) is the shared idiom.
  if (!existsLoud(namespacedJoin(dir))) {
    throw new JobUsageError(`no job '${name}': ${rel} does not exist`);
  }

  // 1. Refuse while the loop is live — removing the state root out from
  // under a running supervisor would strand its ticks.
  const livePid = await liveLoopPid(dir);
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
    const message = opts.commitMessage?.(name) ?? `chore(flume): rm job ${name}`;
    await git(repoRoot, ["commit", "-q", "-m", message, "--", rel]);
    log(`[flume] cleanup commit on current HEAD`);
  } else {
    log(`[flume] no tracked harness under ${rel}; nothing to commit`);
  }

  // 3. Untracked runtime remnants (awake/, prior-attempts/, pid files, and
  // any stale @dtmd/flume link left by a pre-0.9 job dir) — the ignore
  // entries kept them out of git, so git rm left them behind. fs.rm unlinks
  // a stale junction/symlink without following it; the link target is never
  // touched.
  await rm(namespacedJoin(dir), { recursive: true, force: true });

  // 4. Stale metadata from the job's fanout worktrees.
  await git(repoRoot, ["worktree", "prune"]);
  log(`[flume] removed ${rel}`);
}

/** One row of `flume job status`. */
export interface JobStatus {
  /** Job name — the directory segment under `.flume/jobs/`. */
  name: string;
  /**
   * Awake phases from the job's baton, sorted; empty means hibernating.
   * `null` when the job has an `awake/` dir that could not be read for a
   * reason other than absence (permission denied, a path too long for the
   * platform, …) — an unreadable baton is not a hibernating one, and it must
   * not read as one (`.claude/rules/engineering.md`, "Loud or nothing").
   */
  awake: string[] | null;
  /**
   * Entry count from `<jobdir>/plan/pending.json`: 0 when the file is absent
   * (nothing planned is nothing pending), `null` when it exists but does not
   * parse — surfaced, not thrown, so one broken plan never hides the others.
   */
  pending: number | null;
  /**
   * Files under the job's declared friction dir, counted when the caller
   * supplies `frictionDir` (the repo chain's `Chain.friction`,
   * job-dir-relative — `jobStatus` has no chain of its own to load, so the
   * caller resolves it once and passes it in). `undefined` when no
   * `frictionDir` is given; `null` when `frictionDir` is given but the dir's
   * contents could not be read for a reason other than the dir being absent
   * (permission denied, a path too long for the platform, …) — surfaced rather
   * than folded into "0 files" (`.claude/rules/engineering.md`, "Loud or
   * nothing").
   */
  frictionCount?: number | null;
}

/**
 * Files (not subdirs) directly under `dir`. `0` when `dir` is absent
 * (`ENOENT` — nothing filed is nothing to count, the same reading
 * `readPendingLoose` gives an absent `pending.json`); `null` when `dir`
 * exists but `readdir` fails for any other reason — that failure is a
 * real unresolved input, not a legitimate zero, so it must not read the
 * same as an empty dir (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Exported so `frictionCountLine` (`src/friction.ts`) shares this
 * ENOENT-vs-other split instead of re-deriving it
 * (`.claude/rules/engineering.md`, "the fix lands at the mechanism").
 */
export function countFrictionFiles(dir: string): number | null {
  try {
    // win32 MAX_PATH (`.claude/rules/platform-facts.md`): dir joins a job
    // dir onto chain.friction, the same construction `harvestFriction`
    // (src/friction.ts) and `writeRevertNote` (src/Dispatcher.ts) guard.
    // namespacedJoin (src/paths.ts) is the shared idiom.
    return readdirSync(namespacedJoin(dir), { withFileTypes: true }).filter(
      (e) => e.isFile(),
    ).length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    return null;
  }
}

/**
 * Chain-less informational read of a pending.json at `pendingPath`: absent
 * (`ENOENT`) reads as the empty, valid list (nothing planned is nothing
 * pending); present reads through `parsePendingLoose` (core fields
 * validated, no extension composed — never a write path). Any other read
 * failure (permission denied, a path too long for the platform, …) is
 * rethrown rather than folded into the absent case
 * (`.claude/rules/engineering.md`, "Loud or nothing") — rethrowing lets each
 * caller decide how to surface it: `flume status` (`src/cli.ts`) has a
 * single job in scope, so its own try/catch reports the failure and exits
 * non-zero; `jobStatus`, below, has siblings in scope, so it catches per-job
 * instead and reads the failing job as "unparsable" without aborting the
 * enumeration. The one probe both surfaces call, so a corrupt file reads
 * "unparsable" identically on either surface.
 */
export function readPendingLoose(pendingPath: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(namespacedJoin(pendingPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, entries: [], errors: [] };
    }
    throw err;
  }
  return parsePendingLoose(raw);
}

/**
 * One job's awake phases: `[]` when it has no `awake/` dir (`ENOENT` — the
 * baton is hibernating), `null` when the dir exists but cannot be read for
 * any other reason (permission denied, an untraversable job dir, a path too
 * long for the platform, …). That failure is a real unresolved input, so it
 * reads neither as hibernating nor as an exception out of the enumeration —
 * one job's unreadable baton must not hide its siblings
 * (`.claude/rules/engineering.md`, "Loud or nothing"), the same per-job
 * containment `jobStatus` gives an unreadable `pending.json`.
 *
 * The existence probe comes first because the `Baton` constructor mkdirs its
 * dir and `job status` writes nothing; the read itself is `Baton.awake()`, so
 * the dotfile filter and the sort stay the baton's own.
 */
function readAwake(dir: string): string[] | null {
  try {
    if (!existsLoud(namespacedJoin(awakeDir(dir)))) return [];
    return new Baton(dir).awake();
  } catch (err) {
    // A dir removed between the probe and the read is the absent reading
    // still, not an unreadable one.
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
  }
}

/**
 * `flume job status`: enumerate `.flume/jobs/*` in the working tree — awake
 * phases + pending count per job. Observational: reads only what exists and
 * writes nothing. The Baton constructor mkdirs `awake/`, so it is constructed
 * only when that dir is already on disk (mkdir on an existing dir is a no-op);
 * non-directories under `jobs/` are skipped.
 *
 * `frictionDir`, when supplied, is the repo chain's declared `Chain.friction`
 * — job-dir-relative, so the same string applies to every job. Omitted → every
 * row's `frictionCount` is `undefined`.
 *
 * `pendingPath` (spec/pending.md "The pending queue"), when supplied, is the
 * repo chain's declared `Chain.pendingPath` — job-dir-relative, the same
 * idiom as `frictionDir`. Omitted defaults to `plan/pending.json`, same as
 * the repo-level default.
 */
export function jobStatus(
  repoRoot: string,
  frictionDir?: string,
  pendingPath?: string,
): JobStatus[] {
  const root = jobsRoot(repoRoot);
  // Absent jobs root (`ENOENT`) is no jobs. Any other read failure escapes:
  // it hides every job at once, which "no jobs" reports as an empty repo
  // (`.claude/rules/engineering.md`, "Loud or nothing"). win32 MAX_PATH:
  // namespacedJoin (src/paths.ts) is the shared idiom — otherwise a too-long
  // path is one more failure misread as absent.
  let entries: Dirent[];
  try {
    entries = readdirSync(namespacedJoin(root), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const dir = jobDir(repoRoot, name);
      const awake = readAwake(dir);
      // readPendingLoose rethrows a non-ENOENT read failure (permission
      // denied, a path too long for the platform, …) — a per-job read error
      // must not abort the enumeration for every sibling job, so it reads
      // as unparsable here rather than escaping the map.
      let pending: number | null;
      try {
        const parsed = readPendingLoose(resolvePendingPath(dir, pendingPath));
        pending = parsed.ok ? parsed.entries.length : null;
      } catch {
        pending = null;
      }
      const frictionCount =
        frictionDir !== undefined
          ? countFrictionFiles(join(dir, frictionDir))
          : undefined;
      return {
        name,
        awake,
        pending,
        ...(frictionCount !== undefined ? { frictionCount } : {}),
      };
    });
}
