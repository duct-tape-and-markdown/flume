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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Runs the install implied by whichever lockfile `dir` contains:
 * `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`; `package-lock.json`
 * → `npm ci`; both present → pnpm wins (flume's own convention); neither →
 * rejects instead of guessing a package manager.
 *
 * Drop into a chain's fanout `setupWorktree` hook:
 * ```ts
 * async setupWorktree({ worktreePath }) {
 *   await setupWorktree(worktreePath);
 * },
 * ```
 */
export async function setupWorktree(dir: string): Promise<void> {
  const hasPnpmLock = existsSync(join(dir, "pnpm-lock.yaml"));
  const hasNpmLock = existsSync(join(dir, "package-lock.json"));

  if (hasPnpmLock) {
    // shell: pnpm is a .cmd shim on Windows; Node can't spawn those bare.
    await execFileP("pnpm", ["install", "--frozen-lockfile"], {
      cwd: dir,
      shell: process.platform === "win32",
    });
    return;
  }

  if (hasNpmLock) {
    // Same .cmd-shim reasoning as pnpm above.
    await execFileP("npm", ["ci"], {
      cwd: dir,
      shell: process.platform === "win32",
    });
    return;
  }

  throw new Error(
    `setupWorktree: no pnpm-lock.yaml or package-lock.json found in ${dir} — ` +
      "refusing to guess a package manager. Commit one of the two " +
      "lockfiles, or write a custom setupWorktree hook for this chain.",
  );
}
