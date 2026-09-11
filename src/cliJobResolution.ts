/**
 * State-root and config-dir resolution (v0.6 §3, §12/§14) — the `--job` /
 * `FLUME_JOB` / `FLUME_DIR` / `FLUME_CONFIG_DIR` arithmetic and its two
 * refusal shapes, split out of `src/cli.ts` (`.claude/rules/posture-sweep.md`,
 * "A violation counts only when verified on disk this tick").
 */

import { resolve, join, dirname, basename } from "node:path";
import { existsSync } from "node:fs";

/**
 * `--job <name>` given alongside an explicitly-set `FLUME_DIR`: two
 * resolution authorities for one state root (v0.6 §3). The CLI maps this to
 * a usage error (exit 2). An explicit `FLUME_CONFIG_DIR` composes instead —
 * the authority was always over state, and config never belonged to the job.
 */
export class JobResolutionConflictError extends Error {}

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
 * remedy-agreement pins in `tests/cliJobResolution.test.ts` read the var
 * names back out of the message and apply them, so a message that names a
 * remedy which does not clear the refusal fails the suite.
 */
export class CrossRepoFlumeDirError extends Error {}

/**
 * Walk up from `cwd` looking for the nearest `.flume` — the same resolution
 * git applies to `.git/` (RELEASE-v0.7 §9). `cwd` itself counts as inside
 * the bay: if its basename is `.flume`, the bay root is its parent, no walk
 * needed. If no ancestor has a `.flume`, fall back to `cwd` unchanged so a
 * first `flume job new` in a fresh, undocked repo still creates `.flume`
 * there rather than reaching for an unrelated ancestor.
 */
export function resolveRepoRoot(cwd: string): string {
  if (basename(cwd) === ".flume") return dirname(cwd);
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".flume"))) return dir;
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
 * Job resolution (v0.6 §3): `jobFlag` (the global `--job <name>`) or a
 * pre-set `FLUME_JOB` retargets only the `flumeDir` default (state root →
 * `<repoRoot>/.flume/jobs/<name>`) and writes `FLUME_JOB` back alongside the
 * dirs, so loop-spawned tick children inherit the whole resolution via env.
 * `configDir` never retargets — the chain is repo-resident (§2), so it stays
 * `<repoRoot>/.flume` (or explicit `FLUME_CONFIG_DIR`, which composes: env
 * owns the chain+prompts dir, job owns state). The flag is a strict authority
 * over the state root — an explicitly-set `FLUME_DIR` beside it throws
 * {@link JobResolutionConflictError}. `FLUME_JOB` from env composes with an
 * explicit `FLUME_DIR` instead of conflicting: on the loop → tick boundary
 * the child sees all three written-back vars, and the dir vars *are* the
 * parent's canonical job resolution, so set dirs win and the job name rides
 * along for the branch guard and fanout namespacing.
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
  jobFlag?: string,
): { flumeDir: string; configDir: string; job: string | undefined } {
  if (jobFlag && env.FLUME_DIR) {
    throw new JobResolutionConflictError(
      `--job ${jobFlag} conflicts with explicit FLUME_DIR: one resolution authority — drop --job or unset the env`,
    );
  }
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
  const job = jobFlag ?? (env.FLUME_JOB || undefined);
  const flumeDir = env.FLUME_DIR
    ? resolve(env.FLUME_DIR)
    : job
      ? join(repoRoot, ".flume", "jobs", job)
      : join(repoRoot, ".flume");
  const configDir = env.FLUME_CONFIG_DIR
    ? resolve(env.FLUME_CONFIG_DIR)
    : join(repoRoot, ".flume");
  env.FLUME_DIR = flumeDir;
  env.FLUME_CONFIG_DIR = configDir;
  env.FLUME_DIR_RESOLVED_FOR = resolve(repoRoot);
  if (job) env.FLUME_JOB = job;
  return { flumeDir, configDir, job };
}
