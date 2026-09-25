/**
 * fsProbe — the loud existence probe, held in one place so every existence
 * gate in the engine spells the ENOENT-vs-other split the same way
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 *
 * Nothing beyond `node:fs` and `node:path` here: the CLI, the job verbs, and
 * anything else that gates on a path being present can reach it without a
 * cycle.
 */

import { statSync, type Stats } from "node:fs";
import { dirname, join, relative, sep, toNamespacedPath } from "node:path";

/**
 * `path`'s `Stats` iff it exists, `undefined` only when it is absent
 * (`ENOENT`). Any other stat failure (permission denied, a symlink loop, a
 * path too long for the platform, an ancestor that is present and is not a
 * directory, …) throws. The split {@link existsLoud} is the boolean face of,
 * handed out whole for a caller that must also decide *what* is at the path —
 * a directory read proving its own dir is absent rather than obstructed
 * ({@link isDirectoryOrAbsent}).
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
 * {@link isDirectoryOrAbsent} runs and what a caller needing a cross-host
 * absence reaches for.
 *
 * The fold for win32's total-path limit is the caller's, not this probe's:
 * `namespacedJoin` (`src/paths.ts`) where the caller has segments to join,
 * `toNamespacedPath` where the path arrived whole. Unlike
 * {@link isDirectoryOrAbsent}, this call owns no walk and so composes
 * nothing.
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
 * split `readPendingLoose` (`src/pendingLedger.ts`) and
 * `countFrictionFiles` (`src/friction.ts`) give a read, and the same win32 bound {@link statLoud} declares: a caller whose silent
 * arm needs that absence *proven* takes {@link existsLoudUnder} instead.
 *
 * The fold for win32's total-path limit is the caller's, not this probe's:
 * `namespacedJoin` (`src/paths.ts`) where the caller has segments to join,
 * `toNamespacedPath` where the path arrived whole. Unlike
 * {@link isDirectoryOrAbsent}, this call owns no walk and so composes
 * nothing.
 */
export function existsLoud(path: string): boolean {
  return statLoud(path) !== undefined;
}

/**
 * Whether a directory stands at the last path of `descent`: `true` when it
 * does, `false` when that path or any ancestor named ahead of it is absent,
 * and a throw for everything else — a plain file at one of them, a symlink
 * loop, permission denied ({@link statLoud}).
 *
 * `false` is a **proven** absence, which a single stat cannot make: the errno
 * an obstructed ancestor raises is the one thing about it that is not
 * portable (`.claude/rules/platform-facts.md`, *win32 reports a path through
 * a non-directory as not found*), so a reader keying its silent arm off that
 * errno refuses on one host and reports "nothing there" on the other. Hence
 * the descent: `descent` is the chain of directories from the outermost one
 * the caller is willing to answer for down to the one being read, each
 * asserted a directory before the next is probed, so both hosts answer alike.
 *
 * `what` names the subject in the refusal — the store or dir whose read is
 * being proven, as a bare noun phrase ("prior-attempt store").
 *
 * The one reader of a directory this walk cleared may list it without an
 * ENOENT arm of its own: every ancestor is proven, so a listing failure there
 * is real (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Unlike {@link statLoud}, this call namespaces each segment itself, because
 * it owns the whole walk rather than a path a caller composed; the refusal
 * names the plain path, which is the one an operator has to go fix.
 *
 * A caller holding a root and a directory beneath it rather than the rungs
 * between them hands both to {@link isDirectoryOrAbsentUnder}, which composes
 * the descent and delegates here.
 */
export function isDirectoryOrAbsent(
  what: string,
  ...descent: [string, ...string[]]
): boolean {
  for (const path of descent) {
    const st = statLoud(toNamespacedPath(path));
    if (st === undefined) return false;
    if (!st.isDirectory())
      throw new Error(
        `[flume] ${what} is unreadable: ${path} is present but is not a directory`,
      );
  }
  return true;
}

/**
 * {@link isDirectoryOrAbsent} over the descent from `root` down to `path`,
 * composed here rather than at each reader: the rungs between a root a caller
 * answers for and the directory it is about to list are mechanical, and a
 * reader spelling them itself is one forgotten segment from keying its silent
 * arm off an unproven ancestor again (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 *
 * `root` is the outermost directory the caller is willing to answer for — the
 * state root a chain declared, the common dir git resolved — and every segment
 * beneath it is asserted a directory in turn, so `false` is the proven absence
 * an errno cannot make (`.claude/rules/platform-facts.md`, *win32 reports a
 * path through a non-directory as not found*). A reader whose rungs are not
 * one contiguous walk — a fan of sibling directories under one proven root —
 * calls {@link isDirectoryOrAbsent} with its own list instead.
 */
export function isDirectoryOrAbsentUnder(
  what: string,
  root: string,
  path: string,
): boolean {
  const descent: [string, ...string[]] = [root];
  let at = root;
  // `relative` answers in the host's dialect and `join` normalizes each rung,
  // so a `..` leg of an escaping path still lands on `path` itself last.
  for (const segment of relative(root, path).split(sep)) {
    if (segment === "") continue;
    at = join(at, segment);
    descent.push(at);
  }
  return isDirectoryOrAbsent(what, ...descent);
}

/**
 * {@link existsLoud} at `path`, over a proven descent from `root` down to the
 * directory holding it: `true` when something stands at `path`, `false` only
 * when it — or one of the directories between `root` and it — is absent, and a
 * throw for everything else, the refusal {@link isDirectoryOrAbsent} names.
 *
 * The file-leaf face of that descent, for a reader whose subject is one file
 * and whose silent arm is "nothing filed yet": a loop lock, a stop flag, a tip
 * claim. The bare probe cannot prove that absence, and says so — a plain file
 * at any ancestor answers the leaf's own stat `ENOENT` on win32
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so a guard keyed off one stat reports "no
 * supervisor", "no stop requested" or "tip unclaimed" over a state root it
 * never resolved. The descent is what answers alike on both hosts, and it is
 * composed here rather than at each guard, which is one forgotten rung from
 * reading an unproven ancestor as silence again
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * `root` is the outermost directory the caller answers for — a state root a
 * chain declared, the common dir git resolved — and `path` is a file beneath
 * it; `what` names the subject the refusal reports, as it does for the descent
 * itself. Every path is namespaced here, the rungs by the walk and the leaf
 * because it arrived whole, so a caller hands plain paths and the refusal
 * names the path an operator has to go fix.
 */
export function existsLoudUnder(
  what: string,
  root: string,
  path: string,
): boolean {
  if (!isDirectoryOrAbsentUnder(what, root, dirname(path))) return false;
  return statLoud(toNamespacedPath(path)) !== undefined;
}
