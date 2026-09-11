/**
 * paths — shared path machinery: the win32 total-path-limit fix idiom, the
 * glob matcher, the filesystem-safe tag slug, and the layout of the flume
 * state root itself.
 *
 * For the MAX_PATH idiom see `.claude/rules/platform-facts.md`, "Windows
 * MAX_PATH (~260 chars) breaks fs calls with no long component"; every call
 * site that builds a path for an fs call wants both steps together, and this
 * is the one place that pairs them.
 *
 * The state-root layout (bottom of this file) is here for the same reason
 * and imports nothing beyond `node:path`, so the CLI, the dispatcher, the
 * baton, and the job verbs can all reach it without a cycle.
 */

import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from "node:path";

/** `join(...paths)`, then `toNamespacedPath` — the win32 MAX_PATH fix idiom. */
export function namespacedJoin(...paths: string[]): string {
  return toNamespacedPath(join(...paths));
}

/**
 * Shared escape-check for a declared state-root-relative path
 * (`Chain.friction` — `validateFrictionDeclaration`, `src/friction.ts`;
 * `Chain.pendingPath` — `validatePendingPathDeclaration`,
 * `src/Dispatcher.ts`): must be relative, and must still resolve inside the
 * root it is joined to.
 *
 * Base-independent: it resolves the declared path against an arbitrary
 * sentinel root and asks whether the result still sits under that root, so
 * it needs no actual `flumeDir` value. That value legitimately varies per
 * call site (a job-scoped run's state root differs from `configDir`, where
 * `chain.ts` itself lives), but "does this relative path escape whatever
 * root it's joined to" is a property of the path string alone.
 *
 * Here rather than beside either caller because both reach it, and because
 * the check is path shape and nothing else — one spelling, so two declared
 * fields cannot disagree about what escaping the state root means
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 */
export function assertStateRootRelative(
  fieldName: string,
  value: string,
  shapeHint: string,
): void {
  if (isAbsolute(value)) {
    throw new Error(
      `chain declares ${fieldName} '${value}' as an absolute path; ` +
        `Chain.${fieldName} must be a state-root-relative ${shapeHint}`,
    );
  }
  const sentinelRoot = resolve("__flume_state_root__");
  const resolved = resolve(sentinelRoot, value);
  const rel = relative(sentinelRoot, resolved);
  const escapesRoot =
    rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapesRoot) {
    throw new Error(
      `chain declares ${fieldName} '${value}' which resolves outside the state root; ` +
        `Chain.${fieldName} must be a state-root-relative ${shapeHint}`,
    );
  }
}

/**
 * Minimal glob matcher supporting `*`, `**`, and literal paths. We avoid a
 * dependency here so the harness has zero runtime deps beyond zod. Shared
 * home for every consumer that judges a real commit path against a declared
 * (possibly glob) path list — the write guard and ship detection both need
 * this, and a caller-local copy is how the two drift apart.
 */
export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegex(g).test(path));
}

function globToRegex(glob: string): RegExp {
  // Order matters: replace `**` before `*` to avoid overlap.
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*");
  return new RegExp(`^${re}$`);
}

/**
 * A fanout tick's entry-scoped write allowance: the assigned entry's declared
 * files ∪ the phase's channel globs, deduped. Shared home for the two
 * independent consumers that must never state a different fence —
 * `effectiveFenceLines` (`src/Prompt.ts`) renders it for the agent,
 * `writablePathsGate` (`src/builtinGates.ts`) enforces it against the commit
 * (engineering.md "Derived state is computed, never restated beside its
 * source").
 */
export function entryWriteScopeUnion(
  entryPaths: string[],
  channelPaths: string[],
): string[] {
  return [...new Set([...entryPaths, ...channelPaths])];
}

/**
 * Filesystem-safe slug for a pending tag — shared by worktree + prior-attempt
 * keying. Never lengthens the input (runs of disallowed chars collapse to a
 * single `-`), so anything bounding raw `tag` length also bounds this.
 *
 * Here rather than beside either consumer because both reach it: the
 * dispatcher's worktree dir/branch naming and `src/priorAttempts.ts`'s record
 * keying, plus the chain-facing copy handed out on `FlumeApi`. One spelling,
 * so a worktree and the record keyed for the same entry cannot disagree.
 *
 * `tag` itself is length-bounded at the schema gate (`PendingSchema.ts`
 * `TAG_MAX_LENGTH`), derived from the dispatcher's own
 * tightest raw-tag consumer, `writeRevertNote`'s
 * `` `${stamp}--${entry.tag}--reverted.md` `` — every tag-derived path
 * component built from this slug (`createWorktree`'s worktree-dir and
 * branch-name, `src/friction.ts`'s `harvestFriction`
 * `` `${tag}--${stamp}--${file.name}` ``)
 * is looser and stays within filesystem NAME_MAX (255) by construction as a
 * result.
 * Agreement between the two sides is pinned by tests/Dispatcher.test.ts,
 * "revert note to the friction channel (§5)", not asserted here.
 */
export function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

// ---------- the state root's layout ----------

/**
 * The names the runtime itself owns directly under a flume state root
 * (`flumeDir`) — the baton dir, the prior-attempt records, the merge-stage
 * markers, the one-supervisor lock, the stop flag, the tick verdicts. Writer and reader of each of these sit in different
 * modules (`flume stop` refuses, the supervisor honors; `flume loop` claims
 * the lock, `liveLoopPid` reads it back), so a copy of the name in each is a
 * rename away from a silent bypass — this is the one place any of them is
 * spelled (`.claude/rules/engineering.md`, "Derived state is computed, never
 * restated beside its source").
 *
 * Exported for the one consumer that needs a bare name rather than a path:
 * the job `.gitignore` seed (`RUNTIME_IGNORES`, `src/job.ts`). Everything
 * that builds a path takes an accessor below.
 *
 */
export const STATE_ROOT_NAMES = {
  awake: "awake",
  priorAttempts: "prior-attempts",
  renderedPrompts: "rendered-prompts",
  worktrees: "worktrees",
  merging: "merging",
  loopLock: "loop.pid",
  stopFlag: "stop",
  tickVerdict: "tick-verdict.json",
  tickVerdictsLog: "tick-verdicts.jsonl",
} as const;

/**
 * The instant, in the filesystem-safe form every timestamp-prefixed runtime
 * filename uses (`:` and `.` are not portable in a path component). One
 * writer for the format, so a session capture, a revert note, a friction
 * harvest, and a rendered-prompt record all sort and parse alike.
 */
export function fsStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** The baton's awake-flag dir — `<flumeDir>/awake` (`src/Baton.ts`). */
export function awakeDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.awake);
}

/**
 * Where prior-attempt records and their reverted-file snapshots live —
 * gitignored harness runtime state beside the baton, NOT in a per-entry
 * worktree (a fanout retry gets a fresh worktree; the record must outlive
 * it). Re-exported from `src/Dispatcher.ts` so a chain's `shouldRun` can
 * scan the dir the dispatcher writes without hardcoding its name.
 */
export function priorAttemptsDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.priorAttempts);
}

/**
 * Where each invocation's fully rendered prompt is persisted before the
 * agent runs (spec/prompt.md "The rendered prompt is persisted before the
 * agent runs") — the read-side record beside the prior-attempt dir, named on
 * the tick verdict's invocation row as a path relative to `flumeDir`.
 */
export function renderedPromptsDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.renderedPrompts);
}

/**
 * The fanout worktree base: `FLUME_WORKTREES_DIR` when set (resolved
 * absolute), else `<flumeDir>/worktrees` (spec/worktrees.md, "Placement —
 * the worktree base and the job namespace").
 *
 * **The one resolution in `src/`.** `createWorktree`, the per-wave
 * stale-slug removal it runs, and `sweepStaleWorktrees` all take the base
 * from here. Two resolutions agreed only by luck: a sweep basing on the
 * default while creation honored the override found nothing to remove, then
 * failed every `git branch -D` against worktrees still standing at the real
 * base (field-traced four times).
 *
 * The override exists for one measured vector: an agent whose `pwd` contains
 * the root checkout's path as a prefix can derive the root and write there
 * (observed: a model that sees `<root>/.flume/worktrees/x` operates in
 * `<root>`). Pointing the base outside every repo-path prefix removes the
 * prefix, and with it the inference. The default tracks the state root,
 * itself relocatable via `FLUME_DIR`, so the one-`rm` teardown promise holds.
 *
 * Read at call time, not at module load: the CLI resolves `FLUME_DIR` and a
 * chain may export `FLUME_WORKTREES_DIR` during its own load, both after
 * this module is first evaluated.
 *
 * Machine-local placement is the operator's per host — there is deliberately
 * no `Chain.worktreesDir`, since a committed chain file is the wrong home
 * for it.
 */
export function worktreesBase(flumeDir: string): string {
  const override = process.env.FLUME_WORKTREES_DIR;
  return override ? resolve(override) : join(flumeDir, STATE_ROOT_NAMES.worktrees);
}

/**
 * spec/loop.md "Crash equals stop": where the merge stage leaves one marker
 * per entry whose span it is mid-way through putting on trunk —
 * `<flumeDir>/merging/<slug>.json`. Written before the pick and removed once
 * the ship bookkeeping has landed, so a file here at the next `loop` / `job
 * run` start is a merge a crash interrupted and the run refuses.
 *
 * Same split as {@link tickVerdictPath}: this module owns the name so the
 * CLI's startup refusal can reach it without importing the dispatcher, and
 * `src/Dispatcher.ts` owns what the file carries and when.
 */
export function mergingDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.merging);
}

/**
 * One entry's marker under {@link mergingDir}, keyed by its `slugify`d tag —
 * the same slug the entry's worktree and prior-attempt record use, so an
 * operator reconciling a survivor reads one identity across all three.
 */
export function mergingMarkerPath(flumeDir: string, slug: string): string {
  return join(mergingDir(flumeDir), `${slug}.json`);
}

/**
 * The cross-process loop lock — one supervisor per state root. `flume loop`
 * writes its pid here; `liveLoopPid` (`src/job.ts`) and `flume status` read
 * it back.
 */
export function loopLockPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.loopLock);
}

/**
 * The graceful-stop flag (spec/loop.md "Graceful stop — the stop flag"):
 * `flume stop` writes it, `flume loop` refuses to start over it, and the
 * supervisor's per-iteration check ends a live run on it.
 */
export function stopFlagPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.stopFlag);
}

/**
 * The latest tick's verdict alone, overwritten every real `flume tick` and
 * removed by `clearTickVerdict` before that tick's own work begins.
 * Re-exported from `src/Dispatcher.ts`, which owns what the file carries and
 * when — this module owns only the name, so the job `.gitignore` seed can
 * reach it without importing the dispatcher.
 */
export function tickVerdictPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.tickVerdict);
}

/**
 * The append-only verdict history `readTickVerdicts` (`src/Dispatcher.ts`)
 * reads back for a chain's recent-tick rendering. Same split as
 * {@link tickVerdictPath}: the name here, the semantics there.
 */
export function tickVerdictsLogPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.tickVerdictsLog);
}

/**
 * The pending queue's path when `Chain.pendingPath` is undeclared, relative
 * to the state root (spec/pending.md "The pending queue"). Callers that
 * resolve against a state root want {@link resolvePendingPath}; this is for
 * the ones that report the relative form to an operator.
 */
export const DEFAULT_PENDING_REL = join("plan", "pending.json");

/**
 * The queue file a state root actually reads: the chain's declared
 * `pendingPath` when it has one, {@link DEFAULT_PENDING_REL} otherwise,
 * resolved against `stateRoot`. Every consumer of the queue — the
 * dispatcher, `flume check`, `flume status`, `flume job status` — resolves
 * it here, so an undeclared queue is the same absolute file on all of them.
 */
export function resolvePendingPath(stateRoot: string, declared?: string): string {
  return join(stateRoot, declared ?? DEFAULT_PENDING_REL);
}
