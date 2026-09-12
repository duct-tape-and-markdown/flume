/**
 * fsProbe — the loud existence probe, held in one place so every existence
 * gate in the engine spells the ENOENT-vs-other split the same way
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 *
 * Nothing beyond `node:fs` here: the CLI, the job verbs, and anything else
 * that gates on a path being present can reach it without a cycle.
 */

import { statSync } from "node:fs";

/**
 * `true` iff `path` exists, `false` only when it is absent (`ENOENT`). Any
 * other stat failure (permission denied, a symlink loop, a path too long for
 * the platform, …) throws: `existsSync` collapses every stat error to
 * `false`, so a path that is present but unreachable reads as absent and the
 * caller proceeds over an unresolved input
 * (`.claude/rules/engineering.md`, "Loud or nothing"). Same split
 * `readPendingLoose` and `countFrictionFiles` (`src/job.ts`) give a read.
 *
 * Callers pass a `namespacedJoin`ed path (`src/paths.ts`) — win32 MAX_PATH is
 * the caller's join, not this probe's.
 */
export function existsLoud(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false }) !== undefined;
}
