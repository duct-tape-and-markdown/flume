/**
 * State-root and config-dir resolution — the `FLUME_DIR` / `FLUME_CONFIG_DIR`
 * arithmetic, the bay walk-up it resolves against, and the two refusals that
 * arithmetic carries.
 *
 * Named for the two roots it resolves, because that is the whole job: one
 * checkout resolves one state root (`spec/jobs.md`, *The checkout is the unit
 * of isolation*), so there is no third selector to arbitrate between and no
 * second authority to conflict with.
 */

import { readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

import { existsLoud, statLoud } from "./fsProbe.js";
import {
  defaultStateRoot,
  namespacedJoin,
  STATE_ROOT_DIRNAME,
  STATE_ROOT_NAMES,
} from "./paths.js";

/**
 * The family this module's refusals take: a pair of roots that will not
 * compose, thrown where they resolve and reported by the seam that asked for
 * them. One class at that seam's catch, so a refusal added here reaches the
 * operator as a sentence rather than through the CLI's raw-stack arm.
 */
export class StateRootResolutionError extends Error {}

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
export class CrossRepoFlumeDirError extends StateRootResolutionError {}

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
 * A second state root resolved in a checkout that already holds flume state of
 * its own. One checkout resolves one state root (`spec/jobs.md`, *The checkout
 * is the unit of isolation*), and the two would key everything they separate
 * by the same checkout: one tip, one tip claim, one branch namespace, one
 * worktree base. Unrefused, that surfaces several steps on as git's error over
 * a branch the first root's tick holds, in a vocabulary naming neither root.
 */
export class SecondStateRootError extends StateRootResolutionError {}

/**
 * The runtime-owned name under `<repoRoot>/.flume` that makes the bay a state
 * root the runtime has written into, or `undefined` when the checkout holds no
 * flume state of its own.
 *
 * The bay the walk above probes for, read one level deeper — and the depth is
 * the whole distinction. A bay holding a chain and its convention dirs is this
 * run's *config* dir, which `FLUME_CONFIG_DIR` leaves at the default while
 * `FLUME_DIR` relocates state alone: the documented split (spec/cli.md,
 * *State-root and config-dir resolution*), and no second root at all. A bay
 * holding any of `STATE_ROOT_NAMES` is a root with a baton, a worktree base
 * or a verdict log of its own, which is the flume state a second root in the
 * same checkout collides with.
 *
 * Only a directory can hold state, so a bay that is a plain file answers
 * `undefined`: what this asks is whether a *second* root stands in the
 * checkout, and an obstructed bay is neither that question nor its refusal.
 */
function checkoutStateRootArtifact(repoRoot: string): string | undefined {
  const bay = namespacedJoin(defaultStateRoot(repoRoot));
  const at = statLoud(bay);
  if (at === undefined || !at.isDirectory()) return undefined;
  // The bay is proven a directory here, so a listing failure is real and
  // throws (`.claude/rules/engineering.md`, *Loud or nothing*).
  const present = new Set(readdirSync(bay));
  return Object.values(STATE_ROOT_NAMES).find((name) => present.has(name));
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
 *
 * Second-state-root refusal: a resolved `flumeDir` that is not the checkout's
 * own, in a checkout that already holds flume state of its own
 * ({@link checkoutStateRootArtifact}), throws {@link SecondStateRootError} —
 * before the write-back, so neither root is published and nothing downstream
 * is provisioned under either (`spec/jobs.md`, *The checkout is the unit of
 * isolation*). This is the one disk read the arithmetic makes, and the one
 * place it needs one: relocating state alone while the chain stays in the bay
 * is the documented split, so the bay's presence decides nothing here and its
 * contents decide everything.
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
  // The checkout's own state root: what both dirs default to, and what the
  // second-root refusal below compares a relocated one against.
  const own = defaultStateRoot(repoRoot);
  const flumeDir = env.FLUME_DIR ? resolve(env.FLUME_DIR) : own;
  const configDir = env.FLUME_CONFIG_DIR ? resolve(env.FLUME_CONFIG_DIR) : own;
  if (resolve(flumeDir) !== resolve(own)) {
    const artifact = checkoutStateRootArtifact(repoRoot);
    if (artifact !== undefined)
      throw new SecondStateRootError(
        `state root ${flumeDir} was resolved in checkout ${repoRoot}, which ` +
          `already holds flume state of its own at ${own} — ${artifact} ` +
          `stands there. One checkout resolves one state root: both of these ` +
          `key their work by this checkout's tip, its tip claim and its ` +
          `branch names, so the second one separates nothing and fails ` +
          `several steps on as git's error over a branch the first root's ` +
          `tick holds. Give this effort a checkout of its own (git worktree ` +
          `add) and run it there, or leave FLUME_DIR unset to resolve ${own}.`,
      );
  }
  env.FLUME_DIR = flumeDir;
  env.FLUME_CONFIG_DIR = configDir;
  env.FLUME_DIR_RESOLVED_FOR = resolve(repoRoot);
  return { flumeDir, configDir };
}
