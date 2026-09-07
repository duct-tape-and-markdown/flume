/**
 * Shared CLI-subprocess harness — the tsx/dist/cli.mjs + src/cli.ts entry
 * paths, the hermetic env, and the runCli/gitOut subprocess wrappers that
 * cli.test.ts, job.test.ts, job.integration.test.ts, and
 * loop-process-boundary.integration.test.ts each hand-rolled a copy of.
 * Not *.test.ts, so neither vitest lane (unit or integration) collects it
 * as a suite of its own.
 */

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Run the source CLI through the project's own `tsx` (no build step in this
// repo) — via `node <tsx cli.mjs>`, not the `.bin/tsx` shim: the shim is a
// shell script (`.cmd` on win32) that `execFile` cannot spawn without a
// shell (§6 spawn discipline). Absolute paths so cwd can be any caller's
// temp repo; tsx resolves cli.ts's own imports relative to cli.ts,
// independent of cwd.
export const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
export const TSX_CLI = fileURLToPath(
  new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
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

/** Spawn one real `flume <args>`; collect combined output + exit code. */
export async function runCli(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticEnv(),
): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [TSX_CLI, CLI, ...args],
      { cwd, env },
    );
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

/** Run a git subprocess in `cwd`; return its trimmed stdout. */
export async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}
