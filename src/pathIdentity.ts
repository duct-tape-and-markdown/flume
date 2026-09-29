/**
 * pathIdentity — one path in the spelling both sides of a comparison can be
 * held to: the name the OS itself reports for it.
 *
 * One job, because one directory has many names. A junctioned install, a
 * symlinked checkout, a `FLUME_DIR` typed through a link: each hands the
 * engine a second spelling of a path it already holds, and every comparison
 * that decides whether two paths are one thing has to fold before it
 * compares. Every one that does resolves here rather than beside itself, so a
 * spelling one of them folds is a spelling all of them fold
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). The set,
 * each named by what it refuses on disagreement:
 *
 * - the CLI's entry check against the path it was invoked by;
 * - the bay root against the root git names paths from;
 * - a relocated state root against the checkout's own bay
 *   (`resolveStateDirs`, `src/cliStateDirs.ts`);
 * - an inherited `FLUME_DIR_RESOLVED_FOR` stamp against this invocation's
 *   repo root, beside it;
 * - a worktree's state-root stamp against the run reading it
 *   (`stampVerdict`, `src/worktrees.ts`), at both readers that would
 *   destroy a directory — provisioning's occupied path and the startup sweep.
 *
 * `realpathSync` in its native form throughout, for the reason
 * `tests/helpers/fixtureRoot.ts` gives — only the libuv binding asks the OS
 * for the name it holds, which is the name git reports; node's JS walk
 * rebuilds its answer out of the components it was handed and leaves win32's
 * 8.3 alias exactly as it found it. It is also the one form that takes the
 * namespaced path composed below, on a node `engines` admits
 * (`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\`
 * prefix only where nothing resolved*). The choice is pinned rather than
 * remembered: the namespaced-fs scan (`tests/namespacedFsPaths.test.ts`)
 * reds a composed path spelled at the JS head anywhere in `src/` or
 * `harness/`.
 *
 * The argument goes in composed and the answer comes back through
 * `plainPath` (`src/paths.ts`), the fold every path spent on a comparison
 * rather than handed back to an fs call takes here
 * (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component*).
 */

import { realpathSync } from "node:fs";
import { resolve, toNamespacedPath } from "node:path";

import { plainPath } from "./paths.js";

/**
 * One path's on-disk identity, beside the error the resolving leg threw when
 * it is the degraded leg that answered. The resolving leg throws on a path
 * that is not on disk — an argv[1] naming a file that was never there — and
 * the folded raw path is the honest answer then: a file that is absent is
 * not the subject either way, and the caller must not crash over it.
 *
 * Both legs fold through `plainPath`, the resolving one and the throwing one
 * alike, so a comparison made on the answer is made in one alphabet whatever
 * either side resolved.
 *
 * The degraded leg is declared here, per `.claude/rules/engineering.md`
 * *Loud or nothing*: nothing downstream refuses on it, because a path that
 * names no file is a legitimate argv[1] and a throw out of a module-level
 * call would take an import with it. What bounds it instead is that the
 * answer is never handed back to an fs call — it is only ever compared —
 * and that it carries what sent it there, so a comparison decided by an
 * unresolved side reds naming the error rather than a second spelling of one
 * file.
 */
type OnDiskIdentity = {
  /** The folded path the comparison is made on, resolved or not. */
  readonly identity: string;
  /**
   * What the resolving leg threw, when the degraded leg is the one that
   * answered. Absent exactly when the path resolved.
   */
  readonly unresolved?: Error;
};

export function onDiskIdentity(path: string): OnDiskIdentity {
  try {
    return { identity: plainPath(realpathSync.native(toNamespacedPath(path))) };
  } catch (err) {
    return { identity: plainPath(path), unresolved: err as Error };
  }
}

/**
 * A directory in that same spelling, absolutized: {@link onDiskIdentity}'s
 * answer through `resolve`, which folds git's forward slashes onto the host
 * separator so `C:/r` and `C:\r` are one directory rather than two.
 *
 * The face a *root* comparison takes, where the question is only whether two
 * names are the same directory and there is no second answer to carry: a
 * path that will not resolve falls back to its absolutized spelling, and
 * each comparison this feeds refuses on disagreement, so the fallback can
 * only make two names that are the same directory look different — never the
 * reverse.
 */
export function canonicalDir(path: string): string {
  return resolve(onDiskIdentity(path).identity);
}
