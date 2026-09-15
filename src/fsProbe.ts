/**
 * fsProbe — the loud existence probe, held in one place so every existence
 * gate in the engine spells the ENOENT-vs-other split the same way
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 *
 * Nothing beyond `node:fs` here: the CLI, the job verbs, and anything else
 * that gates on a path being present can reach it without a cycle.
 */

import { statSync, type Stats } from "node:fs";

/**
 * `path`'s `Stats` iff it exists, `undefined` only when it is absent
 * (`ENOENT`). Any other stat failure (permission denied, a symlink loop, a
 * path too long for the platform, an ancestor that is present and is not a
 * directory, …) throws. The split {@link existsLoud} is the boolean face of,
 * handed out whole for a caller that must also decide *what* is at the path —
 * a directory read proving its own dir is absent rather than obstructed
 * (`PriorAttemptStore.readAll`, src/priorAttempts.ts).
 *
 * The raw call plus this catch is the spelling, because `statSync`'s
 * `throwIfNoEntry: false` cannot express the split: it suppresses `ENOTDIR`
 * alongside `ENOENT`, so a path under an obstructed ancestor answers "absent"
 * and every gate above it proceeds over an input it never resolved
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*).
 *
 * One bound, declared here rather than left looking like an accident: win32
 * answers that same lookup `ENOENT`, so on that host an obstructed ancestor
 * is indistinguishable from an absent leaf and this probe reads it as absent
 * whatever it does with the errno. A single stat cannot prove absence there.
 * The proof that answers alike on both hosts is a descent — each ancestor
 * asserted a directory before the next segment is probed — which is what
 * `PriorAttemptStore.readAll` does and what a caller needing a cross-host
 * absence reaches for.
 *
 * Callers pass a `namespacedJoin`ed path (`src/paths.ts`) — win32 MAX_PATH is
 * the caller's join, not this probe's.
 */
export function statLoud(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * `true` iff `path` exists, `false` only when it is absent (`ENOENT`). Any
 * other stat failure (permission denied, a symlink loop, a path too long for
 * the platform, an ancestor that is present and is not a directory, …)
 * throws: `existsSync` collapses every stat error to `false`, so a path that
 * is present but unreachable reads as absent and the caller proceeds over an
 * unresolved input (`.claude/rules/engineering.md`, "Loud or nothing"). Same
 * split `readPendingLoose` and `countFrictionFiles` (`src/job.ts`) give a
 * read, and the same win32 bound {@link statLoud} declares.
 *
 * Callers pass a `namespacedJoin`ed path (`src/paths.ts`) — win32 MAX_PATH is
 * the caller's join, not this probe's.
 */
export function existsLoud(path: string): boolean {
  return statLoud(path) !== undefined;
}
