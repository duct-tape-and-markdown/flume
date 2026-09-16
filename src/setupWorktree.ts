/**
 * setupWorktree — lockfile-aware worktree provisioning.
 *
 * A fresh worktree holds only tracked files; something has to
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

import { existsLoud } from "./fsProbe.js";
import { namespacedJoin } from "./paths.js";
import { execFileWithShimRetry } from "./spawnShim.js";

/**
 * How much of an install's output one run of this hook holds, in bytes.
 *
 * Nothing here reads what comes back — the install runs for its effect on
 * `node_modules` — but node buffers it regardless, and a run that outgrows
 * the cap is killed with `SIGTERM` and reported where an exit status would
 * sit, never as a truncation (`.claude/rules/platform-facts.md`, *Node caps
 * a captured child stream at 1 MiB, and reports the overrun as a spawn
 * failure*). Inherited, that default turns a large-but-successful install
 * into a worktree the engine says could not be provisioned.
 *
 * Sized as a runaway ceiling rather than a working set: a cold install of a
 * large workspace prints a progress line per package and crosses 1 MiB
 * routinely, while nothing legitimate approaches this.
 */
const INSTALL_OUTPUT_CAP_BYTES = 64 << 20;

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
 * Drop into a chain's `setupWorktree` hook, on a phase of either
 * concurrency:
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
    await execFileWithShimRetry("pnpm", ["install", "--frozen-lockfile"], {
      cwd: dir,
      maxBuffer: INSTALL_OUTPUT_CAP_BYTES,
    });
    return;
  }

  if (hasNpmLock) {
    await execFileWithShimRetry("npm", ["ci"], {
      cwd: dir,
      maxBuffer: INSTALL_OUTPUT_CAP_BYTES,
    });
    return;
  }

  throw new Error(
    `setupWorktree: no pnpm-lock.yaml or package-lock.json found in ${dir} — ` +
      "refusing to guess a package manager. Commit one of the two " +
      "lockfiles, or write a custom setupWorktree hook for this chain.",
  );
}
