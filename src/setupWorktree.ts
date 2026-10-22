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

/** One install the shipped installer can run, and the lockfile that names it. */
interface Install {
  /** The lockfile whose presence names this install, in the directory read. */
  readonly lockfile: string;
  readonly bin: string;
  readonly args: readonly string[];
}

/**
 * What one directory's lockfiles say about installing it: the install the
 * first one present names, or none — and either way the whole set this
 * installer reads, so a caller refusing over the absence names the lockfiles
 * rather than spelling them a second time
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * Neither shape is exported: nothing outside names either type, and the one
 * function below that returns this one is reached by name
 * (`.claude/rules/engineering.md`, *An export earns its consumer*).
 */
interface InstallPlan {
  readonly install?: Install;
  /** Every lockfile name this installer reads, in the precedence it reads them. */
  readonly lockfiles: readonly string[];
}

/**
 * The installs this helper can run, in precedence order: both lockfiles
 * present → pnpm wins (flume's own convention).
 */
const INSTALLS: readonly Install[] = [
  {
    lockfile: "pnpm-lock.yaml",
    bin: "pnpm",
    args: ["install", "--frozen-lockfile"],
  },
  { lockfile: "package-lock.json", bin: "npm", args: ["ci"] },
];

/**
 * Which install `dir`'s lockfiles imply, read without running anything —
 * what {@link setupWorktree} decides from, reported so a caller that cannot
 * afford to learn it by provisioning a tree asks instead of guessing. A
 * chain declaring no provisioning of its own is the standing caller: it
 * takes this installer, and whether this installer can read *this* tree is
 * knowable at load (`harness/provisioning.ts`).
 *
 * Absent is the only silent reading of either probe: `existsLoud`
 * (src/fsProbe.ts) throws on a lockfile that is present but unstattable,
 * where `existsSync` read it as absent and the refusal below became a guess
 * — a pnpm repo demoted to `npm ci`, or an npm repo told it committed no
 * lockfile at all. Both answers are confidently wrong about a tree whose
 * lockfile was never read (`.claude/rules/engineering.md`, "Loud or
 * nothing"). Every probe runs before any of them decides, so an unreadable
 * lockfile throws even where one ahead of it in precedence already answered.
 */
export function installPlan(dir: string): InstallPlan {
  const lockfiles = INSTALLS.map((install) => install.lockfile);
  const present = INSTALLS.filter((install) =>
    existsLoud(namespacedJoin(dir, install.lockfile)),
  );
  const first = present[0];
  return first === undefined ? { lockfiles } : { install: first, lockfiles };
}

/**
 * Runs the install `dir`'s own lockfile implies ({@link installPlan}):
 * `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`; `package-lock.json`
 * → `npm ci`; neither → rejects instead of guessing a package manager.
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
  const { install, lockfiles } = installPlan(dir);

  if (install === undefined) {
    throw new Error(
      `setupWorktree: no ${lockfiles.join(" or ")} found in ${dir} — ` +
        "refusing to guess a package manager. Commit one of those " +
        "lockfiles, or write a custom setupWorktree hook for this chain.",
    );
  }

  await execFileWithShimRetry(install.bin, [...install.args], {
    cwd: dir,
    maxBuffer: INSTALL_OUTPUT_CAP_BYTES,
  });
}
