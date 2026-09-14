/**
 * The ignore lines a consumer's state root needs (`spec/harness.md`, *The
 * runtime ignore set*) — the engine's runtime-owned names, addressed from
 * the repo root the consumer's `.gitignore` sits at.
 *
 * **A consumer never hand-maintains this list.** Every name here is the
 * engine's to rename, and a hand-written copy goes stale in the direction
 * that looks fine: the retired line keeps matching nothing while the renamed
 * path arrives untracked, which the clean-tree gate reads as a dirty tree on
 * whatever tick happens to run next. Derived, a rename lands in the set the
 * moment the engine ships it.
 *
 * **Why the engine's own ignore lines rather than its names.** A gitignore
 * line carries one fact past the name — whether the entry is a directory,
 * spelled as a trailing separator — and the engine already states it, in the
 * set it seeds every job dir's `.gitignore` with (`RUNTIME_IGNORES`,
 * `src/job.ts`). A job dir is a state root, so those lines are this set
 * modulo the prefix; respelling them here would be a second copy of the
 * directory/file split, agreeing with the first only by care
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * That set carries one line the runtime does not own — `node_modules/`,
 * which is the job template's — so the filter keys on the engine's path
 * record (`STATE_ROOT_NAMES`, `src/paths.ts`) rather than on the literal:
 * what survives is engine-owned by construction, and a line the template
 * adds later is dropped without this module being touched.
 *
 * Paths are **relative to a state root the caller supplies** and
 * slash-joined, as everything else the package addresses is (`records.ts`):
 * these are git paths, and the package hardcodes no consumer's state root.
 *
 * This module is the set alone. Writing it into a consumer's `.gitignore` —
 * creating the file, merging into one that already has lines — belongs to
 * the verb that adopts the package.
 */

import { RUNTIME_IGNORES } from "../src/job.js";
import { STATE_ROOT_NAMES } from "../src/paths.js";

/** The engine's path record, as a membership test over its bare names. */
const ENGINE_OWNED: ReadonlySet<string> = new Set<string>(
  Object.values(STATE_ROOT_NAMES),
);

/**
 * Every ignore line `stateRoot` needs for the runtime state the engine
 * writes into it, in the engine's own order — `.flume/awake/`,
 * `.flume/loop.pid`, and the rest, for a consumer whose state root is
 * `.flume`.
 *
 * `stateRoot` is the path the consumer's `.gitignore` addresses it by: a
 * repo-root-relative `.flume` for the file at the repo root, a deeper path
 * for a state root that sits below one.
 */
export function consumerIgnores(stateRoot: string): string[] {
  return RUNTIME_IGNORES.filter((line) =>
    ENGINE_OWNED.has(line.replace(/\/$/, "")),
  ).map((line) => `${stateRoot}/${line}`);
}
