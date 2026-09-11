/**
 * Shared CLI-subprocess harness — the tsx/dist/cli.mjs + src/cli.ts entry
 * paths, the hermetic env, and the runCli/gitOut subprocess wrappers that
 * cli.test.ts, job.test.ts, job.integration.test.ts, and
 * loop-process-boundary.integration.test.ts each hand-rolled a copy of.
 * Not *.test.ts, so neither vitest lane (unit or integration) collects it
 * as a suite of its own.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Refuse when a spawned-CLI entry point is not on disk, naming the path and
 * the provisioning that supplies it.
 *
 * Both entry points below are repo-root-adjacent absolute paths with no
 * upward walk, so either can miss while Node's own resolution — which does
 * walk up — still finds a parent checkout's copy and starts vitest. `node
 * <missing>.mjs` then exits 1 without ever reaching flume, and that 1 is
 * indistinguishable from the exit code the suite's `code).toBe(1)`
 * assertions exist to check: a whole CLI suite passes over a CLI that never
 * started (`.claude/rules/engineering.md`, "A green verdict is proven
 * non-vacuous").
 *
 * The guard wraps the constants rather than `runCli`, because the two
 * integration suites spawn `[TSX_CLI, CLI, ...]` themselves; an unresolvable
 * entry point cannot be exported past this point by any caller.
 */
export function requireEntryPoint(path: string, remedy: string): string {
  if (existsSync(path)) return path;
  throw new Error(
    `flume test harness: CLI entry point missing: ${path}\n` +
      `The CLI cannot start, so every exit code this suite asserts would be ` +
      `node's, not flume's. Fix: ${remedy}`,
  );
}

// Run the source CLI through the project's own `tsx` (no build step in this
// repo) — via `node <tsx cli.mjs>`, not the `.bin/tsx` shim: the shim is a
// shell script (`.cmd` on win32) that `execFile` cannot spawn without a
// shell (§6 spawn discipline). Absolute paths so cwd can be any caller's
// temp repo; tsx resolves cli.ts's own imports relative to cli.ts,
// independent of cwd.
export const CLI = requireEntryPoint(
  fileURLToPath(new URL("../../src/cli.ts", import.meta.url)),
  "restore src/cli.ts — this checkout is missing the CLI source",
);
export const TSX_CLI = requireEntryPoint(
  fileURLToPath(
    new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
  ),
  "run `pnpm install --frozen-lockfile` in this worktree — a parent " +
    "checkout's node_modules does not satisfy this path",
);

/**
 * The identity/provenance FLUME_* keys an outer flume harness is known to
 * set. `hermeticEnv()` does not strip by this list — it strips every
 * `/^FLUME_/` key (below) — so the list is seed input only: cli.test.ts sets
 * each one ambiently to prove the strip is non-vacuous without restating
 * the harness's vocabulary (`.claude/rules/engineering.md`, "Derived state
 * is computed, never restated beside its source").
 */
export const HERMETIC_ENV_STRIP_KEYS: readonly string[] = [
  "FLUME_DIR",
  "FLUME_CONFIG_DIR",
  "FLUME_JOB",
  "FLUME_DIR_RESOLVED_FOR",
  "FLUME_TIP_CLAIM_HELD",
];

/**
 * A copy of this process's env with every `FLUME_*` key stripped, so a
 * spawned CLI resolves the caller's own temp dir/repo default — or the
 * test's own explicit job resolution — instead of inheriting this process's.
 * Without this the suite is not hermetic: run under a flume harness (whose
 * canonicalized env, including a job resolution and its provenance stamp,
 * the vitest process inherits), the child would either escape the fixture
 * and operate on the outer state root/branch, or — once FLUME_DIR is
 * overridden per-test but the stale stamp survives — misfire
 * `CrossRepoFlumeDirError` against the outer repo it was actually stamped
 * for (CLI-FLUMEDIR-PROVENANCE-STAMP).
 *
 * By prefix, never by list: the supervisor adds vars a list falls behind
 * (`FLUME_QUARANTINED_SLUGS` after the first quarantine of a run), and this
 * suite runs as an afterMerge gate inside exactly that process. A test that
 * wants a `FLUME_*` var layers it on top of this function's output.
 */
export function hermeticEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^FLUME_/.test(key)) delete env[key];
  }
  return env;
}

/**
 * A fresh temp fixture directory that **owns its own bay** — `mkdtemp`, plus
 * an empty `.flume` planted at the root.
 *
 * Bay discovery walks up from cwd to the nearest `.flume` and only falls back
 * to cwd at the filesystem root (spec/cli.md, "Bay discovery walks up to the
 * nearest `.flume`"). A fixture rooted at `mkdtemp(tmpdir(), …)` therefore
 * resolves through `/tmp`'s ancestors: any `.flume` a crashed run, another
 * suite, or an unrelated process leaves at `/tmp` — or above it — captures
 * every fixture below and silently retargets `repoRoot`, every state-dir
 * resolution, and every `job` verb at the litter. The suite then asserts a
 * verdict the CLI reached about a directory the test never wrote
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 *
 * The planted `.flume` stops the walk at the fixture, so no ancestor can
 * change a verdict regardless of who wrote the litter. It is behaviour-inert
 * for the fixture itself: an empty bay is what `<dir>/.flume` resolution
 * already assumed, and nothing reads a directory that holds no chain, no
 * baton markers, and no queue.
 *
 * `parent` exists for the tests that plant the ancestor litter deliberately —
 * they need a fixture underneath a directory they control. Fixtures that are
 * never a CLI cwd (a scratch output dir, a worktree base handed over by env)
 * do not need rooting and keep plain `mkdtemp`.
 *
 * Not rootable: a fixture whose subject **is** the no-ancestor fallback. It
 * must reach the filesystem root without meeting a `.flume`, which no fixture
 * can guarantee — `resolveRepoRoot`'s fallback case in
 * `tests/cliJobResolution.test.ts` is the one such site in this suite.
 */
export async function mkFixtureRoot(
  prefix: string,
  parent: string = tmpdir(),
): Promise<string> {
  const dir = await mkdtemp(join(parent, prefix));
  await mkdir(join(dir, ".flume"), { recursive: true });
  return dir;
}

/**
 * The exit status carried by a rejected `execFile`, or a refusal.
 *
 * `execFile` rejects for two unrelated reasons: the child ran and exited
 * non-zero (numeric `code`), or the child never produced an exit status at
 * all — spawn failure (`code` is an errno *string*) or a kill (`code` absent,
 * `signal` set). Defaulting the second case to 1 reports a status no process
 * returned, into assertions that check for exactly 1.
 */
export function exitStatusOf(err: unknown): number {
  const e = err as { code?: unknown; signal?: unknown };
  if (typeof e.code === "number") return e.code;
  throw new Error(
    `flume test harness: the CLI subprocess produced no exit status ` +
      `(code=${String(e.code)}, signal=${String(e.signal)}) — it never ran, ` +
      `or it was killed. Underlying failure: ${String(err)}`,
  );
}

/**
 * Spawn one real `flume <args>`; collect the two streams apart, plus the
 * exit code. For assertions that turn on *which* stream carried a line — an
 * observational verb whose stdout must stay unchanged while a failure report
 * rides stderr. `runCli` is this with the streams concatenated.
 */
export async function runCliStreams(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticEnv(),
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [TSX_CLI, CLI, ...args],
      { cwd, env },
    );
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: exitStatusOf(err),
    };
  }
}

/** Spawn one real `flume <args>`; collect combined output + exit code. */
export async function runCli(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticEnv(),
): Promise<{ out: string; code: number }> {
  const { stdout, stderr, code } = await runCliStreams(cwd, args, env);
  return { out: stdout + stderr, code };
}

/** Run a git subprocess in `cwd`; return its trimmed stdout. */
export async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}
