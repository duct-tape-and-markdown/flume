/**
 * Every read a plan slice's window makes of the tree: the commits past a
 * cursor with the paths each touched, the diffs inside that range, the lines
 * the range deleted, and the corpus listing a window with no cursor yet opens
 * over — all under one pathspec dialect.
 *
 * **This module knows nothing about slices.** It is handed a working tree, a
 * revision and a list of path globs, and it answers in commits, paths and
 * patch text. Which cursor a range is drawn past, what a glob list means to a
 * consumer, and what an unreadable range does to a tick belong to the windows
 * that drive this (`cursorWindow.ts` and the three slice windows beside it).
 *
 * **Paths are judged here by the engine's `matchesAny`, never by git.** A
 * declared glob is read in exactly one dialect, and git is never handed a
 * second one to reinterpret — git's own pathspec globbing agrees with
 * `matchesAny` on the common cases and diverges on enough of the rest to be a
 * second, silent reading of the declaration.
 *
 * **Nothing here is caught.** A cursor naming no commit is a verdict
 * ({@link resolvesInTree}); every other git failure travels out as a throw,
 * for the caller that bounds a render to name (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 */

import { literalPathspecEnv, nameOnlyPaths } from "../src/git.js";
import { matchesAny } from "../src/paths.js";

import { captureSync } from "./exec.js";

/** One commit in a window's range, with the paths it touched. */
export interface RangeCommit {
  readonly sha: string;
  readonly subject: string;
  readonly paths: readonly string[];
}

/**
 * Record and field separators — control bytes a commit subject does not
 * carry in practice, so a message with a newline or a tab in it cannot be
 * read as a second commit.
 *
 * NUL is not among them: under `-z` git terminates its own `--format` output
 * with it, so the header's end is read off git's terminator ({@link
 * HEADER_END}) rather than off a byte this module chose, and only the record
 * boundary is ours to spell. A subject that did carry `\x1e` splits one
 * record into two, which costs the render a sha git cannot resolve — a throw
 * the window's own bound names, never a silently wrong window
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Emitted by git's own `%xNN` escape rather than written into the argument,
 * matching the terminator's own encoding at the one place both are read.
 */
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const RECORD_SEP_FMT = "%x1e";
const FIELD_SEP_FMT = "%x1f";

/**
 * The NUL `-z` puts after the `--format` output, and the newline git writes
 * between that and a commit's file listing. A commit that touched nothing
 * has the terminator and no newline after it.
 */
const HEADER_END = "\0";
const LISTING_LEAD = "\n";

/**
 * Every read in this module, under one pathspec dialect.
 *
 * The paths these reads narrow by come straight from git's own
 * `--name-only` output, so a filename carrying `*`, `?`, `[` or a leading
 * `:` would otherwise be re-read as a glob or as pathspec magic and the
 * narrowed diff would quietly show the wrong files. `literalPathspecEnv`
 * (`src/git.ts`) is the engine's one spelling of that refusal, shared rather
 * than re-derived here (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*); it replaces a local `:(top,literal)` prefix whose `top`
 * leg anchored nothing, since `cwd` is the tick's working tree root and
 * these paths are already relative to it.
 *
 * `core.quotePath=false` buys only the patch text the renders paste into the
 * prompt, and only its non-ASCII case: a `+++ b/<path>` header naming a
 * UTF-8 filename reads as the filename rather than as escaped octal. A
 * control character stays quoted there regardless. It is not what makes a
 * *listing* faithful — every path this module goes on to judge or hand back
 * to git is read `-z` and decoded by {@link nameOnlyPaths}, which is the one
 * form quoting cannot reach (`src/git.ts`).
 *
 * What the spawn itself is — how much of a diff fits on stdout, and what a
 * failing git's own text is — is the package's one sync spawn's
 * ({@link captureSync}, `harness/exec.ts`). Only the dialect is this
 * module's.
 */
function git(cwd: string, args: readonly string[]): string {
  return captureSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    env: literalPathspecEnv(),
  });
}

/** Whether `sha` names a commit in the tree at `cwd`. */
export function resolvesInTree(cwd: string, sha: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "-q", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** The sha at the tree's tip. */
export const tipOf = (cwd: string): string =>
  git(cwd, ["rev-parse", "HEAD"]).trim();

/**
 * Every tracked path the globs name, in git's own listing order.
 *
 * `-z`, decoded by the engine's own {@link nameOnlyPaths}, for the reason
 * {@link commitsPast} reads its listing that way.
 */
export const filesMatching = (cwd: string, globs: string[]): string[] =>
  nameOnlyPaths(git(cwd, ["ls-files", "-z"])).filter((path) =>
    matchesAny(path, globs),
  );

/**
 * Every commit past `cursor`, oldest first, each with the paths it touched.
 *
 * One scan serves both readers: the liveness predicates ask whether any of
 * these paths matches their globs, and the renders ask which ones and for
 * their diffs.
 *
 * The listing is `-z`, decoded by the engine's own {@link nameOnlyPaths}:
 * the default form quotes and octal-escapes a path carrying a control
 * character or a non-ASCII byte, and line-splits one carrying a newline, so
 * every path this scan judges would be a name git never committed. Exactly
 * one leading newline is dropped ahead of the fields — git writes it between
 * the header's terminator and the listing, and a path that itself begins
 * with a newline arrives behind that separator, not in place of it.
 */
export function commitsPast(cwd: string, cursor: string): RangeCommit[] {
  const raw = git(cwd, [
    "log",
    "--reverse",
    `--format=${RECORD_SEP_FMT}%H${FIELD_SEP_FMT}%s`,
    "--name-only",
    "-z",
    `${cursor}..HEAD`,
  ]);
  return raw
    .split(RECORD_SEP)
    .slice(1)
    .map((block) => {
      const end = block.indexOf(HEADER_END);
      const header = end === -1 ? block : block.slice(0, end);
      const listing = end === -1 ? "" : block.slice(end + HEADER_END.length);
      const [sha = "", subject = ""] = header.split(FIELD_SEP);
      return {
        sha,
        subject,
        paths: nameOnlyPaths(
          listing.startsWith(LISTING_LEAD)
            ? listing.slice(LISTING_LEAD.length)
            : listing,
        ),
      };
    });
}

/** Whether a commit touched anything the window's globs name. */
export const touches = (commit: RangeCommit, globs: string[]): boolean =>
  commit.paths.some((path) => matchesAny(path, globs));

/**
 * Whether any commit past `cursor` touched the window's globs.
 *
 * **Fails open, deliberately.** A window that cannot be read — a cursor that
 * names no commit, a git that will not run — reports the slice live, and the
 * render it wakes then refuses by name for either (`cursorWindow.ts`). The
 * inverse would be worse in the one way that matters: a closed window over an
 * unreadable range is silence, and the next cursor advance would step over
 * commits nobody read (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function touchedPast(
  cwd: string,
  cursor: string,
  globs: string[],
): boolean {
  try {
    return commitsPast(cwd, cursor).some((commit) => touches(commit, globs));
  } catch {
    return true;
  }
}

/** One commit's diff, narrowed to the paths in it the window's globs match. */
function diffOf(cwd: string, commit: RangeCommit, globs: string[]): string {
  const paths = commit.paths.filter((path) => matchesAny(path, globs));
  return git(cwd, ["show", "--stat", "-p", commit.sha, "--", ...paths]);
}

/**
 * The oldest-first prefix of `commits` whose diffs fit `budget` lines, the
 * sha the cursor may advance to, and the commits deferred past it.
 *
 * **The window is rendered whole, or an oldest-first prefix of it.** A
 * truncated preview is the shape this replaces: too big to be a pointer, too
 * small to be the material. The first commit therefore renders whatever its
 * size — a diff larger than the whole budget would otherwise defer itself
 * forever, and a window that can never advance is a loop, not a bound.
 */
export function diffPrefix(
  cwd: string,
  commits: readonly RangeCommit[],
  globs: string[],
  budget: number,
): {
  rendered: string[];
  deferred: RangeCommit[];
  count: number;
  advance: string | undefined;
} {
  const rendered: string[] = [];
  const deferred: RangeCommit[] = [];
  let used = 0;
  let count = 0;
  let advance: string | undefined;
  let stopped = false;

  for (const commit of commits) {
    if (stopped) {
      deferred.push(commit);
      continue;
    }
    const diff = diffOf(cwd, commit, globs).trimEnd();
    const height = diff.split("\n").length;
    if (count > 0 && used + height > budget) {
      stopped = true;
      deferred.push(commit);
      continue;
    }
    rendered.push(diff, "");
    used += height;
    count += 1;
    advance = commit.sha;
  }
  return { rendered, deferred, count, advance };
}

/**
 * The lines `cursor..HEAD` deleted from `paths`, each with the `-` git wrote
 * it under.
 *
 * Read off one diff over the whole range rather than per commit: a line
 * added and then deleted inside the window was never a claim the tree
 * carries, and a per-commit walk would report it as deleted.
 */
export function deletedLines(
  cwd: string,
  cursor: string,
  paths: readonly string[],
): string[] {
  if (paths.length === 0) return [];
  return git(cwd, ["diff", `${cursor}..HEAD`, "--", ...paths])
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"));
}
