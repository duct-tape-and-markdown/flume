/**
 * friction — the friction channel's own home: the declaration check that
 * admits a `Chain.friction` value, the one listing of what the channel holds,
 * the file count behind every status surface and the line they print from it,
 * and the teardown harvest that drains a worktree's mirror into the primary
 * dir.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): one declared
 * directory, one reader, one writer — a job of its own, depending on
 * nothing the dispatcher holds beyond a state root, a state-root-relative
 * path and a logger. The dependency runs one way: the dispatcher, the CLI
 * and the harness package call in here, nothing here calls back.
 *
 * spec/chain.md "The friction channel" and spec/worktrees.md "Teardown
 * harvest — the delivery guarantee" are the contracts these serve.
 *
 * `writeRevertNote` stays in `src/tickAttempt.ts`: it is the gate-revert
 * path's own note, built from a commit message only that attempt reads.
 */

import { readdirSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import type { Logger } from "./log.js";
import { isDirectoryOrAbsentUnder } from "./fsProbe.js";
import * as git from "./git.js";
import {
  assertStateRootRelative,
  boundedName,
  fsStamp,
  isDotName,
  namespacedJoin,
} from "./paths.js";
import { NAME_MAX } from "./PendingSchema.js";
import type { Chain } from "./Phase.js";

/**
 * What the channel's refusal calls the thing it could not read — the noun
 * phrase `isDirectoryOrAbsentUnder` (`src/fsProbe.ts`) names an obstructed
 * ancestor with. One spelling for every read of the channel, so the primary
 * dir, a worktree mirror, the count, and the `friction <name>` read verb
 * (`src/cli.ts`), which proves the same descent for its own absent arm, all
 * tell an operator the same thing about the same rung.
 */
export const FRICTION_SUBJECT = "friction channel";

/**
 * Validate a declared `Chain.friction`: must be relative and
 * must resolve inside the state root, else a usage-shaped error. The check
 * is base-independent — {@link assertStateRootRelative} resolves the
 * declared path against an arbitrary sentinel root and asks whether the
 * result still sits under that root — so it needs no actual `flumeDir`
 * value. That value legitimately varies per call site (a job-scoped run's
 * state root differs from `configDir`, where `chain.ts` itself lives), but
 * "does this relative path escape whatever root it's joined to" is a
 * property of the path string alone. Undeclared `friction` is a strict
 * no-op.
 */
export function validateFrictionDeclaration(chain: Chain): void {
  if (chain.friction === undefined) return;
  assertStateRootRelative(
    "friction",
    chain.friction,
    'directory path (e.g. "friction")',
  );
}

/**
 * What the friction channel at `dir` holds: its direct-child files,
 * dot-prefixed names skipped, as plain names sorted by name. This is the
 * engine's **one** answer to that question — the bare `friction` verb
 * (`src/cli.ts`), {@link countFrictionFiles} below, {@link harvestFriction}'s
 * mirror read, and the harness package's `frictionFiles`
 * (`harness/friction.ts`) all read it rather than walking the dir again
 * (`.claude/rules/engineering.md`, "A fact the engine holds is reported,
 * never rediscovered"). A second walk is a surface that can disagree with
 * the `friction: N` line about what is waiting.
 *
 * A `.gitkeep` git forced the consumer to create is not a note
 * (spec/chain.md, "`Chain.friction` — the declared friction channel"), and
 * the skip is `isDotName` (`src/paths.ts`).
 *
 * An absent dir holds nothing — the channel is created lazily by whichever
 * write needs it first, so "never written to" and "empty" are one fact, the
 * same reading `readPendingLoose` (`src/pendingLedger.ts`) gives an absent
 * queue directory. Every other listing failure **throws**: a dir that is
 * there and cannot be listed is a real unresolved input, and must not read as
 * an empty channel (`.claude/rules/engineering.md`, "Loud or nothing"). Each
 * caller states what it does with that throw — a `null` count, an `EX_IOERR`,
 * a swallowed harvest — and none of them can mistake it for zero.
 *
 * That absence is **proven from the path**, never read off the errno the
 * listing raised, which is why `stateRoot` is a parameter and not something
 * this listing could do without: a plain file anywhere above `dir` answers
 * the listing `ENOENT` on win32 (`.claude/rules/platform-facts.md`, *win32
 * reports a path through a non-directory as not found*), so an errno-keyed
 * silent arm prints `friction: 0`, lists nothing under the `friction` verb
 * and renders an empty inbox window over an obstructed state root on exactly
 * one host. `isDirectoryOrAbsentUnder` (`src/fsProbe.ts`) runs the descent —
 * the root the caller answers for, then each segment down to `dir`, every one
 * asserted a directory before the next is probed — so both hosts answer
 * alike. It is the descent `listUnderStateRoot` (`harness/dirListing.ts`)
 * takes for the record queue and the questions dir, over the one directory
 * whose names are the engine's rather than the package's.
 *
 * win32 MAX_PATH (`.claude/rules/platform-facts.md`): the fold lives here,
 * at the one `readdir`, so callers hand a plain path and get plain names
 * back — `dir` routinely joins a state root or a worktree mirror onto
 * `chain.friction`, the same construction `writeRevertNote`
 * (`src/tickAttempt.ts`) guards. Every ancestor is proven by then, so the
 * listing keeps no absent arm of its own: a failure there is real.
 */
export function frictionNotes(stateRoot: string, dir: string): string[] {
  if (!isDirectoryOrAbsentUnder(FRICTION_SUBJECT, stateRoot, dir)) return [];
  return readdirSync(namespacedJoin(dir), { withFileTypes: true })
    .filter((e) => e.isFile() && !isDotName(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * How many notes the channel at `dir` holds, over {@link frictionNotes}
 * above — `stateRoot` is that listing's, the root the absence is proven from.
 * `0` when `dir` is absent — nothing filed is nothing to count;
 * `null` when the listing threw, which is the dir being there and unreadable.
 * That failure is a real unresolved input, not a legitimate zero, so it must
 * not read the same as an empty dir (`.claude/rules/engineering.md`, "Loud or
 * nothing").
 *
 * Exported so a caller wanting the number alone shares this ENOENT-vs-other
 * split with {@link frictionCountLine} below instead of re-deriving it
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 */
export function countFrictionFiles(
  stateRoot: string,
  dir: string,
): number | null {
  try {
    return frictionNotes(stateRoot, dir).length;
  } catch {
    return null;
  }
}

/**
 * The one rendering of a friction count into the line every status surface
 * prints — `flume status` and the loop-end summary both reach it through
 * {@link frictionCountLine} rather than composing wording of their own
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 *
 * The count is {@link countFrictionFiles}'s three-way reading, and each arm
 * has exactly one wording: `null` — the dir exists but could not be read
 * (permission denied, a path too long for the platform, …) — is a real
 * unresolved input, so it reads `"friction: unreadable"` rather than folding
 * into silence (`.claude/rules/engineering.md`, "Loud or nothing").
 * `undefined` — no friction dir declared — and `0` — declared, nothing filed
 * — both render nothing at all: `undefined`, on which callers print no line.
 * Separators around the line belong to the caller's layout, never to this
 * wording.
 */
function renderFrictionCount(
  count: number | null | undefined,
): string | undefined {
  if (count === null) return "friction: unreadable";
  if (count === undefined) return undefined;
  return count > 0 ? `friction: ${count} note(s) await routing` : undefined;
}

/**
 * The friction count line for a state root: count of files directly under
 * the declared friction dir, resolved against `stateRoot` — whichever state
 * root the caller resolved — rendered by {@link renderFrictionCount}.
 * Undeclared `Chain.friction` is the undefined count: no dir to read, so no
 * line.
 *
 * Counting is {@link countFrictionFiles}; rendering is the shared
 * function above. Nothing here is this surface's own
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 */
export async function frictionCountLine(
  stateRoot: string,
  chain: Chain,
): Promise<string | undefined> {
  if (chain.friction === undefined) return undefined;
  return renderFrictionCount(
    countFrictionFiles(stateRoot, join(stateRoot, chain.friction)),
  );
}

/**
 * What {@link harvestFriction} needs from the dispatcher that owns the
 * worktree being torn down: the primary state root it drains into, that
 * root's path relative to the repo root (`undefined` when the state root is
 * relocated outside it — spec/chain.md "What a gate receives"), and where
 * to log the failures harvest swallows.
 */
interface FrictionHarvestContext {
  flumeDir: string;
  stateRootRel: string | undefined;
  log: Logger;
}

/**
 * The destination filename one harvested file lands under:
 * `<tag>--<stamp>--<source filename>`, put through `boundedName`
 * (`src/paths.ts`) against {@link NAME_MAX}.
 *
 * The bound is load-bearing, not belt-and-braces. Two of the three parts are
 * variable-length, so the tag's own schema ceiling cannot hold the sum:
 * `TAG_MAX_LENGTH` (216) plus two separator pairs and the 24-character stamp
 * is already 244, so a source filename of 12 characters overruns 255.
 * Unbounded, `rename` throws `ENAMETOOLONG`, the per-file catch below logs
 * and continues, and the dispatcher removes the worktree moments later —
 * the note dies with it. That is the silent loss
 * `.claude/rules/engineering.md`, "Loud or nothing" names: the harvest's
 * "left for the removal-fallback sweep to surface" bound covers a worktree
 * still standing afterwards, never a file whose destination could not be
 * written at all.
 *
 * Only the *name* is abbreviated — the note's content is delivered whole —
 * and truncating the finished name with a hash keyed on it keeps every
 * distinctness the unbounded spelling had: a retry writing the same source
 * filename under the same tag still lands beside the earlier note instead of
 * over it (spec/worktrees.md "Teardown harvest — the delivery guarantee"),
 * and two siblings harvested in one call stay two files. Neither `rename`
 * nor the `EXDEV` fallback's `copyFile` refuses an existing destination, so
 * that is the property doing the work.
 */
function harvestedName(tag: string, stamp: string, name: string): string {
  return boundedName(`${tag}--${stamp}--${name}`, NAME_MAX);
}

/**
 * Before a fanout worktree is torn down, move every
 * file its declared friction channel holds *that is untracked at the
 * worktree's own HEAD* into the primary friction dir, prefixed
 * `<tag>--<stamp>--` for provenance and collision-freedom — the stamp
 * (same `Date.toISOString()`-minus-punctuation idiom as `writeRevertNote`)
 * means a retried entry whose agent reuses the same source filename lands
 * beside the earlier note instead of silently replacing it. See
 * {@link harvestedName} for that composition and the NAME_MAX bound it
 * carries. Harvest is harness code crossing the worktree boundary (the
 * sessions precedent), not an agent write — worktree agents still only
 * ever write under their own `$PWD`.
 *
 * The tracked-at-HEAD bound (spec/worktrees.md "Teardown harvest — the
 * delivery guarantee") is what keeps the relay convergent and non-
 * duplicating: a file tracked at the worktree's own HEAD arrived either
 * via the checkout (present since before this tick's agent ran) or via a
 * commit this tick's own agent made — either way it is delivered content
 * already, and re-harvesting it under a stamped name would deposit a
 * duplicate the operator has to reconcile by hand. `git ls-tree` at the
 * worktree's `HEAD` is the existence probe — content is irrelevant, only
 * whether the path is tracked there. `HEAD` is resolved with the worktree
 * itself as the git invocation's cwd, since each linked worktree has its
 * own `HEAD` even though branch refs live in the shared common dir.
 *
 * Undeclared `chain.friction` — no-op. A relocated state root (`flumeDir`
 * outside the repo tree, so `stateRootRel` is `undefined`) has no
 * worktree-local mirror to harvest from — also a no-op. Any failure here
 * (missing dir, unreadable file, locked handle) is logged and swallowed:
 * harvest must never abort the wave, and whatever it can't move is left for
 * the removal-fallback sweep to surface.
 */
export async function harvestFriction(
  chain: Chain,
  worktreePath: string,
  tag: string,
  ctx: FrictionHarvestContext,
): Promise<void> {
  if (chain.friction === undefined) return;
  if (ctx.stateRootRel === undefined) return;

  const mirrorRoot = join(worktreePath, ctx.stateRootRel);
  const mirrorDir = join(mirrorRoot, chain.friction);
  // What counts as a note in the mirror is what counts in the primary dir:
  // {@link frictionNotes} above, so a placeholder relayed here could never
  // land under a stamped name — the one spelling the count and the read verb
  // skip on, turned into one they cannot see. An absent dir (no friction
  // written this tick) is that listing's empty answer and silent here.
  let candidates: string[];
  try {
    candidates = frictionNotes(mirrorRoot, mirrorDir);
  } catch (err) {
    // An unreadable dir, e.g. permissions, or a mirror state root a plain
    // file stands at — the log-and-continue failure class, not a silent
    // no-op.
    ctx.log.warn(
      `[flume] friction harvest: could not read ${mirrorDir}: ${(err as Error).message}`,
    );
    return;
  }
  if (candidates.length === 0) return;

  // Tracked-at-HEAD bound: a file already tracked at the worktree's own
  // `HEAD` — whether the checkout brought it in, or this tick's own
  // agent committed it — is delivered content already, and is left in
  // place rather than re-harvested under a stamped name. Existence only;
  // content is irrelevant to the check.
  const files: string[] = [];
  for (const name of candidates) {
    const relPath = join(ctx.stateRootRel, chain.friction, name);
    let atHead: string | null;
    try {
      atHead = await git.readFileAtRef(worktreePath, "HEAD", relPath);
    } catch (err) {
      // Same log-and-continue class as the readdir/mkdir/rename failure
      // modes below: a probe failure isolates to this one candidate
      // rather than aborting the wave's teardown. Left unmoved, matching
      // the fail-closed default a failed rename already leaves in place.
      ctx.log.warn(
        `[flume] friction harvest: could not probe HEAD for ${relPath}: ${(err as Error).message}`,
      );
      continue;
    }
    if (atHead === null) files.push(name);
  }
  if (files.length === 0) return;

  const primaryDir = join(ctx.flumeDir, chain.friction);
  try {
    await mkdir(namespacedJoin(primaryDir), { recursive: true });
  } catch (err) {
    ctx.log.warn(
      `[flume] friction harvest: could not create ${primaryDir}: ${(err as Error).message}`,
    );
    return;
  }

  // Stamped once per harvest call, not per file (the `writeRevertNote`
  // precedent): siblings moved in the same call already disambiguate on
  // file.name, and a shared stamp still separates this call's files from
  // whatever a prior or later retry of the same tag harvests.
  const stamp = fsStamp();
  for (const name of files) {
    const src = join(mirrorDir, name);
    const dest = join(primaryDir, harvestedName(tag, stamp, name));
    try {
      await rename(namespacedJoin(src), namespacedJoin(dest));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        // Worktree relocated onto a different volume (FLUME_WORKTREES_DIR)
        // — rename can't cross devices; copy then drop the source instead.
        try {
          await copyFile(namespacedJoin(src), namespacedJoin(dest));
          await rm(namespacedJoin(src), { force: true });
          continue;
        } catch (copyErr) {
          ctx.log.warn(
            `[flume] friction harvest: failed to move ${src}: ${(copyErr as Error).message}`,
          );
          continue;
        }
      }
      ctx.log.warn(
        `[flume] friction harvest: failed to move ${src}: ${(err as Error).message}`,
      );
    }
  }
}
