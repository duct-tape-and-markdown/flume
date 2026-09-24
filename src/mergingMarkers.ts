/**
 * The interrupted-merge crash marker — what one
 * `<flumeDir>/merging/<slug>.json` carries, and the read that answers
 * "is a merge still staked out under this state root?"
 *
 * spec/loop.md "Crash equals stop". The wave's merge stage writes a marker
 * around each cherry-pick (`src/waveMerge.ts`); the CLI's startup refusal
 * (`flume loop`) is the reader. The shape sits with the
 * reader rather than inside the leg that stakes it because it is the
 * vocabulary of that seam, not of a tick (`.claude/rules/engineering.md`, *A
 * module is one job*).
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { isDirectoryOrAbsent } from "./fsProbe.js";
import { mergingDir, namespacedJoin } from "./paths.js";

/**
 * spec/loop.md "Crash equals stop": what one `<flumeDir>/merging/<slug>.json`
 * carries — the facts an operator needs to reconcile a merge a crash
 * interrupted between the cherry-pick and the ship bookkeeping.
 *
 * `branch` and `baseSha` bound the span the pick was carrying (the entry's
 * private worktree branch and the tip it was provisioned from), so the work
 * is re-pickable whichever way the reconciliation goes; `tag` names the entry
 * that is still `open` in the queue. The engine states these because it wrote
 * them — nothing here is re-derived from commit shape or authorship
 * (`.claude/rules/engine-boundary.md`, "Told, not inferred").
 */
export type MergingMarker = {
  /** The entry whose span the merge stage was picking. */
  tag: string;
  /** That entry's worktree branch — still standing, since the startup sweep runs after the refusal. */
  branch: string;
  /** The tip the branch was provisioned from: `baseSha..branch` is the span. */
  baseSha: string;
};

/** Structural check a parsed JSON value is shaped like a {@link MergingMarker}. */
function isMergingMarker(rec: unknown): rec is MergingMarker {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as Partial<MergingMarker>;
  return (
    typeof r.tag === "string" &&
    typeof r.branch === "string" &&
    typeof r.baseSha === "string"
  );
}

/**
 * Every merge marker standing under a state root, each paired with the file
 * it was read from — the CLI's startup refusal (`flume loop`) is the one
 * consumer.
 *
 * A file that will not parse, or parses to the wrong shape, still counts:
 * the marker's *presence* is the fact, and degrading an unreadable one to
 * "no interrupted merge" would proceed over exactly the state this refusal
 * exists to stop (`.claude/rules/engineering.md`, "Loud or nothing"). Its
 * `marker` is `undefined` and the caller names the file alone.
 *
 * The directory read takes the same line: an *absent* `merging/` is the
 * honest empty answer — nothing was ever staked — while any other listing
 * failure (permission denied, a file sitting at the path, a path too long
 * for the platform) escapes. An unreachable dir reported as empty would tell
 * the refusal "no interrupted merge" over markers it could not see.
 *
 * That absence is proven from the **path**, never from the errno the listing
 * raised: a plain file at the state root makes `merging/` beneath it `ENOENT`
 * on win32 while posix raises `ENOTDIR` (`.claude/rules/platform-facts.md`,
 * *win32 reports a path through a non-directory as not found*), so an
 * errno-keyed silent arm would start a loop over an obstructed state root on
 * exactly one host. So the same descent `PriorAttemptStore.readAll` runs —
 * the state root, then `merging/`, each asserted a directory before the next
 * is probed ({@link isDirectoryOrAbsent}, src/fsProbe.ts) — and the listing
 * below keeps no absent arm of its own, because every ancestor above it is
 * proven by then.
 */
export async function readMergingMarkers(
  flumeDir: string,
): Promise<Array<{ path: string; marker: MergingMarker | undefined }>> {
  const dir = mergingDir(flumeDir);
  if (!isDirectoryOrAbsent("merging-marker dir", flumeDir, dir)) return [];
  const names = await readdir(namespacedJoin(dir));
  const out: Array<{ path: string; marker: MergingMarker | undefined }> = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const path = join(dir, name);
    let marker: MergingMarker | undefined;
    try {
      const rec: unknown = JSON.parse(
        await readFile(namespacedJoin(path), "utf8"),
      );
      if (isMergingMarker(rec)) marker = rec;
    } catch {
      // unreadable or malformed — the file's presence is still the fact
    }
    out.push({ path, marker });
  }
  return out;
}
