/**
 * friction — the friction channel's own home: the declaration check that
 * admits a `Chain.friction` value, the count line every status surface
 * prints from it, and the teardown harvest that drains a worktree's mirror
 * into the primary dir.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): one declared
 * directory, one reader, one writer — a job of its own, depending on
 * nothing the dispatcher holds beyond a state root, a state-root-relative
 * path and a logger. The dependency runs one way: the dispatcher and the
 * CLI call in here, nothing here calls back.
 *
 * spec/chain.md "The friction channel" and spec/worktrees.md "Teardown
 * harvest — the delivery guarantee" are the contracts these serve.
 *
 * `writeRevertNote` stays in `src/Dispatcher.ts`: it is the gate-revert
 * path's own note, built from a commit message only the dispatcher reads.
 */

import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";

import type { Logger } from "./Dispatcher.js";
import * as git from "./git.js";
import { countFrictionFiles } from "./job.js";
import { assertStateRootRelative, fsStamp, namespacedJoin } from "./paths.js";
import type { Chain } from "./Phase.js";

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
 * The friction count line shared by `flume status`, `flume job status`, and
 * the loop-end summary: count of files directly under the
 * declared friction dir, resolved against `stateRoot` — whichever state
 * root is in play for the caller (the repo's `flumeDir`, or a job's dir).
 * `undefined` when `Chain.friction` is undeclared, the dir is absent
 * (`ENOENT`), or it holds no files — callers print a line only when this
 * resolves to a string — declared and non-empty. When the dir
 * exists but `readdir` fails for any other reason (permission denied, a
 * path too long for the platform, …), that is a real unresolved input, not
 * a legitimate zero: it reads `"friction: unreadable"` rather than folding
 * into the same silence as "nothing declared" or "nothing filed"
 * (`.claude/rules/engineering.md`, "Loud or nothing") — the same split
 * `countFrictionFiles` (`src/job.ts`) gives `flume job status`, reused here
 * rather than re-derived (`.claude/rules/engineering.md`, "the fix lands at
 * the mechanism").
 */
export async function frictionCountLine(
  stateRoot: string,
  chain: Chain,
): Promise<string | undefined> {
  if (chain.friction === undefined) return undefined;
  // win32 MAX_PATH (`.claude/rules/platform-facts.md`): same join(stateRoot,
  // chain.friction) construction writeRevertNote (`src/Dispatcher.ts`) and
  // harvestFriction below guard — namespacedJoin (src/paths.ts) is the
  // shared idiom.
  const count = countFrictionFiles(namespacedJoin(stateRoot, chain.friction));
  if (count === null) return "friction: unreadable";
  return count > 0 ? `friction: ${count} note(s) await routing` : undefined;
}

/**
 * What {@link harvestFriction} needs from the dispatcher that owns the
 * worktree being torn down: the primary state root it drains into, that
 * root's path relative to the repo root (`undefined` when the state root is
 * relocated outside it — spec/chain.md "What a gate receives"), and where
 * to log the failures harvest swallows.
 */
export interface FrictionHarvestContext {
  flumeDir: string;
  stateRootRel: string | undefined;
  log: Logger;
}

/**
 * Before a fanout worktree is torn down, move every
 * file its declared friction channel holds *that is untracked at the
 * worktree's own HEAD* into the primary friction dir, prefixed
 * `<tag>--<stamp>--` for provenance and collision-freedom — the stamp
 * (same `Date.toISOString()`-minus-punctuation idiom as `writeRevertNote`)
 * means a retried entry whose agent reuses the same source filename lands
 * beside the earlier note instead of silently replacing it, since neither
 * `rename` nor the `EXDEV` fallback's `copyFile` refuse an existing
 * destination. Harvest is harness code crossing the worktree boundary (the
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

  const mirrorDir = join(worktreePath, ctx.stateRootRel, chain.friction);
  let entries: Dirent[];
  try {
    // win32 MAX_PATH (`.claude/rules/platform-facts.md`): mirrorDir nests
    // a worktree path under chain.friction. namespacedJoin (src/paths.ts)
    // is the shared idiom — same as writeRevertNote (`src/Dispatcher.ts`).
    entries = await readdir(namespacedJoin(mirrorDir), {
      withFileTypes: true,
    });
  } catch (err) {
    // Absent dir (no friction written this tick) is expected and silent.
    // Anything else — unreadable dir, e.g. permissions — is the
    // log-and-continue failure class, not a silent no-op.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      ctx.log.warn(
        `[flume] friction harvest: could not read ${mirrorDir}: ${(err as Error).message}`,
      );
    }
    return;
  }
  const candidates = entries.filter((e) => e.isFile());
  if (candidates.length === 0) return;

  // Tracked-at-HEAD bound: a file already tracked at the worktree's own
  // `HEAD` — whether the checkout brought it in, or this tick's own
  // agent committed it — is delivered content already, and is left in
  // place rather than re-harvested under a stamped name. Existence only;
  // content is irrelevant to the check.
  const files: Dirent[] = [];
  for (const file of candidates) {
    const relPath = join(ctx.stateRootRel, chain.friction, file.name);
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
    if (atHead === null) files.push(file);
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
  for (const file of files) {
    const src = join(mirrorDir, file.name);
    const dest = join(primaryDir, `${tag}--${stamp}--${file.name}`);
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
