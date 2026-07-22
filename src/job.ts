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
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  if (opts.template !== undefined && !existsSync(opts.template)) {
    throw new JobUsageError(`--template dir not found: ${opts.template}`);
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
  const rel = join(".flume", "jobs", name);
  await git(repoRoot, ["add", "--", rel]);
  const staged = await git(repoRoot, ["status", "--porcelain", "--", rel]);
  if (staged.length > 0) {
    await git(repoRoot, ["commit", "-q", "-m", `chore(flume): seed job ${name}`]);
    log(`[flume] baseline commit on ${branch}`);
  } else {
    log(`[flume] harness already baselined; nothing to commit`);
  }
  // 7. Stay on job/<name> — tune, then `flume job run`.
}
