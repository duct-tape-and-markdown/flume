/**
 * setupWorktree — lockfile-aware fanout worktree provisioning.
 *
 * A fresh fanout worktree holds only tracked files; something has to
 * materialize `node_modules` before gates run, and the install command
 * depends on which lockfile the target repo commits. This is the shared,
 * lockfile-aware default: inspect the target directory, run the install
 * command its lockfile implies, and refuse rather than guess when neither
 * is present.
 *
 * Sibling to the `builtinGates.ts` precedent (`shellGate`, `tscGate`, …) —
 * exported standalone, not as a `Gate`, since provisioning runs before the
 * agent, not as a pass/fail check after it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { existsLoud } from "./fsProbe.js";
import { namespacedJoin } from "./paths.js";

const execFileP = promisify(execFile);

/**
 * execFile with a Windows shim fallback. Package-manager binaries (pnpm,
 * npm) are .cmd shims on Windows, which Node refuses to spawn without a
 * shell (CVE-2024-27980 hardening). A direct spawn is tried first so args
 * keep exact quoting semantics; only a win32 ENOENT — the shim case —
 * retries through the shell. Mirrors `builtinGates.ts`'s `execGate`.
 */
async function execInstall(
  cmd: string,
  args: string[],
  opts: { cwd: string },
): Promise<void> {
  try {
    await execFileP(cmd, args, opts);
  } catch (err) {
    if (
      process.platform === "win32" &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      await execFileP(cmd, args, { ...opts, shell: true });
      return;
    }
    throw err;
  }
}

/**
 * Runs the install implied by whichever lockfile `dir` contains:
 * `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`; `package-lock.json`
 * → `npm ci`; both present → pnpm wins (flume's own convention); neither →
 * rejects instead of guessing a package manager.
 *
 * Absent is the only silent reading of either probe: `existsLoud`
 * (src/fsProbe.ts) throws on a lockfile that is present but unstattable,
 * where `existsSync` read it as absent and the refusal above became a guess
 * — a pnpm repo demoted to `npm ci`, or an npm repo told it committed no
 * lockfile at all. Both answers are confidently wrong about a tree whose
 * lockfile was never read (`.claude/rules/engineering.md`, "Loud or
 * nothing").
 *
 * Drop into a chain's fanout `setupWorktree` hook:
 * ```ts
 * async setupWorktree({ worktreePath }) {
 *   await setupWorktree(worktreePath);
 * },
 * ```
 */
export async function setupWorktree(dir: string): Promise<void> {
  const hasPnpmLock = existsLoud(namespacedJoin(dir, "pnpm-lock.yaml"));
  const hasNpmLock = existsLoud(namespacedJoin(dir, "package-lock.json"));

  if (hasPnpmLock) {
    await execInstall("pnpm", ["install", "--frozen-lockfile"], { cwd: dir });
    return;
  }

  if (hasNpmLock) {
    await execInstall("npm", ["ci"], { cwd: dir });
    return;
  }

  throw new Error(
    `setupWorktree: no pnpm-lock.yaml or package-lock.json found in ${dir} — ` +
      "refusing to guess a package manager. Commit one of the two " +
      "lockfiles, or write a custom setupWorktree hook for this chain.",
  );
}
