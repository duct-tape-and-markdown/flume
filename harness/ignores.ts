/**
 * The ignore lines a consumer's state root needs (`spec/harness.md`, *The
 * runtime ignore set*) — the engine's runtime-owned names plus the package's
 * own per-run artifacts, addressed from the repo root the consumer's
 * `.gitignore` sits at.
 *
 * **A consumer never hand-maintains this list.** Every name here is the
 * engine's or the package's to rename, and a hand-written copy goes stale in
 * the direction that looks fine: the retired line keeps matching nothing
 * while the renamed path arrives untracked, which the clean-tree gate reads
 * as a dirty tree on whatever tick happens to run next. Derived, a rename
 * reaches this set the moment its owner ships it, and a consumer that owns
 * neither side adds no line of its own.
 *
 * **One writer, and the refusal that bounds it.** The derivation being
 * current is not an adopted consumer's `.gitignore` being current.
 * `flume-harness init` (`init.ts`) merges these lines in once, at adoption,
 * and refuses a state root that already exists rather than rewriting one:
 * upgrading is a version bump plus the release's migration note, never a
 * re-run of init (`tests/harnessInit.test.ts`, *flume-harness init refuses a
 * state root that already exists rather than overwriting it*). So a package
 * rename landing after adoption rides that migration note — nothing here
 * propagates it into a file already written (`spec/jobs.md`, *Runtime
 * ignores*).
 *
 * The engine's half of the set has a second writer and does repair itself:
 * the engine re-merges `RUNTIME_IGNORES` into the state root every `loop`
 * start resolves. What leaves the package's half with one writer
 * is that that set names none of the package's own artifacts — the
 * asymmetry this declaration rests on, so it is pinned rather than asserted
 * here (`tests/harnessIgnores.test.ts`).
 *
 * **Why the engine's own ignore lines rather than its names.** A gitignore
 * line carries one fact past the name — whether the entry is a directory,
 * spelled as a trailing separator — and the engine already states it, in the
 * set it merges into every state root's `.gitignore` (`RUNTIME_IGNORES`,
 * `src/runtimeIgnores.ts`). Those lines are this set modulo the prefix, so respelling
 * them here would be a second copy of the
 * directory/file split, agreeing with the first only by care
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * That set carries one line the runtime does not own — `node_modules/` —
 * so the filter keys on the engine's path
 * record (`STATE_ROOT_NAMES`, `src/paths.ts`) rather than on the literal:
 * what survives is engine-owned by construction, and a line the template
 * adds later is dropped without this module being touched.
 *
 * Paths are **relative to a state root the caller supplies** and
 * slash-joined, as everything else the package addresses is (`layout.ts`):
 * these are git paths, and the package hardcodes no consumer's state root.
 *
 * This module is the set alone. Writing it into a consumer's `.gitignore` —
 * creating the file, merging into one that already has lines — belongs to
 * the verb that adopts the package.
 */

import { RUNTIME_IGNORES } from "../src/runtimeIgnores.js";
import { STATE_ROOT_NAMES } from "../src/paths.js";

/** The engine's path record, as a membership test over its bare names. */
const ENGINE_OWNED: ReadonlySet<string> = new Set<string>(
  Object.values(STATE_ROOT_NAMES),
);

/**
 * Where the package's agents tee their transcripts, under the consumer's
 * state root — the one per-run artifact the package itself places
 * (`spec/chain.md`, *Per-run artifacts belong under `FLUME_DIR`*), so a
 * relocated state root carries its own sessions and one `rm` removes the
 * whole footprint.
 *
 * It lives here rather than beside the agent factory that passes it to the
 * session capture (`chain.ts`, which imports it): the ignore set is derived
 * from the footprint, so the footprint is named once and the derivation
 * reads it (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*).
 */
export const SESSIONS_REL = "sessions";

/**
 * The package's own contribution to the set, spelled as the engine spells
 * its own — a trailing separator for a directory.
 *
 * The engine's record cannot carry these. `src/` never imports this
 * directory, so a path the package places under the consumer's state root is
 * the package's to name and the package's to ignore; leaving it out made the
 * gap the consumer's, which is the hand-maintained line this module exists
 * to end.
 */
const PACKAGE_IGNORES: readonly string[] = [`${SESSIONS_REL}/`];

/**
 * Every ignore line `stateRoot` needs for the per-run state written into it
 * — the engine's in the engine's own order, then the package's:
 * `.flume/awake/`, `.flume/loop.pid`, and the rest through
 * `.flume/sessions/`, for a consumer whose state root is `.flume`.
 *
 * `stateRoot` is the path the consumer's `.gitignore` addresses it by: a
 * repo-root-relative `.flume` for the file at the repo root, a deeper path
 * for a state root that sits below one.
 */
export function consumerIgnores(stateRoot: string): string[] {
  return [
    ...RUNTIME_IGNORES.filter((line) => ENGINE_OWNED.has(line.replace(/\/$/, ""))),
    ...PACKAGE_IGNORES,
  ].map((line) => `${stateRoot}/${line}`);
}
