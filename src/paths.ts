/**
 * paths — shared path machinery: the win32 total-path-limit fix idiom, the
 * glob matcher, and the layout of the flume state root itself.
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

import { join, toNamespacedPath } from "node:path";

/** `join(...paths)`, then `toNamespacedPath` — the win32 MAX_PATH fix idiom. */
export function namespacedJoin(...paths: string[]): string {
  return toNamespacedPath(join(...paths));
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
 * A fanout tick's entry-scoped write allowance: the assigned entry's
 * declared files ∪ the phase's channel globs, deduped (RELEASE-v0.7 §2, §5).
 * Shared home for the two independent consumers that must never state a
 * different fence — `effectiveFenceLines` (`src/Prompt.ts`) renders it for
 * the agent, `writablePathsGate` (`src/builtinGates.ts`) enforces it against
 * the commit (engineering.md "Derived state is computed, never restated
 * beside its source").
 */
export function entryWriteScopeUnion(
  entryPaths: string[],
  channelPaths: string[],
): string[] {
  return [...new Set([...entryPaths, ...channelPaths])];
}

// ---------- the state root's layout ----------

/**
 * The names the runtime itself owns directly under a flume state root
 * (`flumeDir`) — the baton dir, the prior-attempt records, the one-supervisor
 * lock, the stop flag. Writer and reader of each of these sit in different
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
 * `worktrees/` is not here: where it lands is the open `Chain.worktreesDir`
 * fork, and it joins this record in whichever commit resolves that fork.
 */
export const STATE_ROOT_NAMES = {
  awake: "awake",
  priorAttempts: "prior-attempts",
  renderedPrompts: "rendered-prompts",
  loopLock: "loop.pid",
  stopFlag: "stop",
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
