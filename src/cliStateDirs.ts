/**
 * State-root and config-dir resolution — the `FLUME_DIR` / `FLUME_CONFIG_DIR`
 * arithmetic, the bay walk-up it resolves against, and the one refusal that
 * arithmetic carries.
 *
 * Named for the two roots it resolves, because that is the whole job: one
 * checkout resolves one state root (`spec/jobs.md`, *The checkout is the unit
 * of isolation*), so there is no third selector to arbitrate between and no
 * second authority to conflict with.
 */

import { resolve, dirname, basename } from "node:path";

import { existsLoud } from "./fsProbe.js";
import {
  defaultStateRoot,
  namespacedJoin,
  STATE_ROOT_DIRNAME,
} from "./paths.js";

/**
 * A `FLUME_DIR_RESOLVED_FOR` stamp already present in the env that disagrees
 * with this invocation's freshly-resolved `repoRoot` — provenance evidence
 * that `FLUME_DIR` was canonicalized and written back by a *different*
 * repo's flume process, then inherited across a process/environment
 * boundary that never should have crossed a repo. Provenance is stamped,
 * never inferred: a `FLUME_DIR` typed fresh for this invocation carries no
 * stamp at all, so it is never refused on this basis regardless of what its
 * path happens to look like.
 *
 * The stamp is what the refusal keys on, so the stamp is what the remedy
 * names: clearing it is necessary, and clearing it *alone* while `FLUME_DIR`
 * still points at the other repo would resolve straight into the hazard this
 * guard exists to stop. The message therefore names both vars when
 * `FLUME_DIR` is set and the stamp alone when it is not — and the
 * remedy-agreement pins in `tests/cliStateDirs.test.ts` read the var
 * names back out of the message and apply them, so a message that names a
 * remedy which does not clear the refusal fails the suite.
 */
export class CrossRepoFlumeDirError extends Error {}

/**
 * Walk up from `cwd` looking for the nearest `.flume` — the same resolution
 * git applies to `.git/`. `cwd` itself counts as inside the bay: if its
 * basename is `.flume`, the bay root is its parent, no walk needed. If no
 * ancestor has a `.flume`, fall back to `cwd` unchanged so a first tick in a
 * fresh, undocked repo still resolves `.flume` there rather than reaching for
 * an unrelated ancestor.
 *
 * Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws on
 * a `.flume` that is present but unstattable (a symlink loop, a
 * permission-denied parent) rather than reading it as absent and walking
 * *past* the operator's own bay to an unrelated ancestor's — or to the
 * no-dock fallback — which would retarget every state-dir resolution that
 * follows (`.claude/rules/engineering.md`, "Loud or nothing").
 */
export function resolveRepoRoot(cwd: string): string {
  if (basename(cwd) === STATE_ROOT_DIRNAME) return dirname(cwd);
  let dir = cwd;
  for (;;) {
    if (existsLoud(namespacedJoin(defaultStateRoot(dir)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

/**
 * Resolve the mutable-state root (`flumeDir`) and the chain+prompt dir
 * (`configDir`) from `env`, canonicalizing each to an **absolute** path, and
 * write the resolved values back into `env`.
 *
 * Writing back is the point: every spawned child — an agent, a gate's shell,
 * a loop-spawned tick — inherits the single resolved value from `FLUME_DIR` /
 * `FLUME_CONFIG_DIR` rather than re-deriving the default or falling back to a
 * coincidentally-equal `configDir`. The env is that child-process channel,
 * not the chain's read path: a chain takes its roots from `FlumeApi.paths`,
 * which `buildFlumeApi` requires and which carries these same values by
 * reference (spec/chain.md, "Per-run artifacts belong under `FLUME_DIR`").
 *
 * Both default to `<repoRoot>/.flume` when unset; a set-but-relative value is
 * resolved against the cwd. Independent of one another: a dock sets both to its
 * ephemeral dir to co-locate config and state.
 *
 * Nothing else retargets `flumeDir` below the root (spec/cli.md, *State-root
 * and config-dir resolution*). `FLUME_DIR` is the one authority over it, so
 * the written-back set is exactly these two dirs and the provenance stamp:
 * a var the resolution never reads is never a var it writes.
 *
 * Cross-repo inheritance refusal: provenance is stamped, never inferred
 * (spec/cli.md, "State-root and config-dir resolution"). The write-back
 * below stamps `FLUME_DIR_RESOLVED_FOR=<repoRoot>` alongside the dirs; a
 * later call that inherits an env already carrying that stamp for a
 * *different* repo throws {@link CrossRepoFlumeDirError} rather than
 * writing there — the shape observed 2026-08-03 when a nested `flume wake`
 * inherited its parent process's `FLUME_DIR` instead of resolving fresh
 * against its own cwd. The refusal fires only when the stamp is present and
 * disagrees; a `FLUME_DIR` typed fresh for this invocation carries no
 * stamp and is never refused on that basis, whatever its path looks like.
 */
export function resolveStateDirs(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
): { flumeDir: string; configDir: string } {
  if (
    env.FLUME_DIR_RESOLVED_FOR &&
    resolve(env.FLUME_DIR_RESOLVED_FOR) !== resolve(repoRoot)
  ) {
    // Both halves of the message vary with whether `FLUME_DIR` came along:
    // an inherited stamp can outlive the dir it was written beside, and
    // naming an unset var — as a value in the evidence or as a var to clear
    // in the remedy — sends the operator to a no-op.
    const evidence = env.FLUME_DIR
      ? `FLUME_DIR ${env.FLUME_DIR} was resolved for repo ${env.FLUME_DIR_RESOLVED_FOR}`
      : `an inherited FLUME_DIR_RESOLVED_FOR stamp names repo ${env.FLUME_DIR_RESOLVED_FOR}`;
    const remedy = env.FLUME_DIR
      ? `Unset FLUME_DIR and FLUME_DIR_RESOLVED_FOR together`
      : `Unset FLUME_DIR_RESOLVED_FOR`;
    throw new CrossRepoFlumeDirError(
      `${evidence}, not this invocation's resolved repo root ${repoRoot} — ` +
        `refusing to write there (inherited from a different repo's flume ` +
        `process). ${remedy} to resolve fresh against this repo.`,
    );
  }
  const flumeDir = env.FLUME_DIR
    ? resolve(env.FLUME_DIR)
    : defaultStateRoot(repoRoot);
  const configDir = env.FLUME_CONFIG_DIR
    ? resolve(env.FLUME_CONFIG_DIR)
    : defaultStateRoot(repoRoot);
  env.FLUME_DIR = flumeDir;
  env.FLUME_CONFIG_DIR = configDir;
  env.FLUME_DIR_RESOLVED_FOR = resolve(repoRoot);
  return { flumeDir, configDir };
}
