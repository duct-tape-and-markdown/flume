/**
 * Phase — the declared shape of one step in a derivation chain.
 *
 * A Phase is data, not code. The Dispatcher (added later) consumes Phases to
 * decide what prompt to send, what to enforce post-commit, how to fan out,
 * and which sibling phases to wake.
 */

import type { Gate } from "./Gate.js";
import type { PendingEntry } from "./PendingSchema.js";

/**
 * Concurrency model for a phase:
 *
 * - "singleton": one tick at a time. Plan and spec phases must be singleton
 *   because they derive shared artifacts (the plan file, the spec corpus)
 *   that don't admit concurrent edits.
 *
 * - "fanout": the dispatcher picks N disjoint-by-Files: pending entries and
 *   runs N tick invocations in parallel worktrees. Build is the canonical
 *   fanout phase. Merging back into the trunk runs serially with a postMerge
 *   gate; failure reverts the wave.
 */
export type Concurrency = "singleton" | "fanout";

/**
 * Context handed to a phase's `promptArgs` builder when constructing the
 * agent invocation for one tick.
 */
export interface TickContext {
  /** Absolute path of the worktree this tick runs in. */
  cwd: string;
  /** Pending entry assigned to this tick (fanout phases only). */
  assignedEntry?: PendingEntry;
  /** All pending entries (singleton phases that read the plan). */
  pending?: readonly PendingEntry[];
}

/**
 * Result a phase reports back after a tick finishes. The handoff function
 * inspects this to decide which sibling phases to wake.
 */
export interface TickResult {
  /** Phase that produced this result. */
  phaseName: string;
  /** True if the tick produced a commit. False on bail or no-op. */
  committed: boolean;
  /** SHA of the produced commit, when present. */
  commitSha?: string;
  /** All gates that ran, in order, with their results. */
  gateResults: ReadonlyArray<{
    gate: string;
    ok: boolean;
    message: string;
  }>;
  /** The pending list as it stands after this tick (re-parsed from disk). */
  pendingAfter: readonly PendingEntry[];
  /** Set of pending tags shipped by this phase (build only; usually 0 or 1). */
  shippedTags: readonly string[];
  /**
   * Tags whose commits were reverted at merge time (cherry-pick conflict or
   * afterMerge gate). Distinguishes a merge-thrash re-pick from an in-session
   * retry in downstream telemetry.
   */
  revertedTags: readonly string[];
}

/**
 * The declared shape of one phase. All fields are data; the harness
 * interprets them. There is no per-phase imperative code path.
 */
export interface Phase {
  /** Stable identifier; matches the awake-flag filename `.flume/awake/<name>`. */
  name: string;

  /** One-line human description; appears in logs and `flume status`. */
  description: string;

  /**
   * Path (relative to the chain's config directory) to the agent prompt file.
   * `{{KEY}}` placeholders are substituted from promptArgs at tick time.
   * `!`shell command`` inline-exec blocks are evaluated before send.
   */
  promptPath: string;

  /** Concurrency model — see Concurrency above. */
  concurrency: Concurrency;

  /**
   * Glob patterns the phase is permitted to modify. Post-commit, the
   * harness diffs the commit against these patterns; violations revert
   * the commit. This replaces prose "You may NOT modify X" rules in prompts.
   *
   * Paths are relative to the repo root. Patterns are minimatch-style.
   */
  writablePaths: string[];

  /** Gates that run at preCommit / postCommit / postMerge points. */
  gates: Gate[];

  /**
   * Builds the prompt argument map for one tick. The dispatcher feeds this
   * the TickContext (with assignedEntry populated for fanout phases).
   *
   * Return values are stringified by the prompt renderer. JSON-shaped
   * arguments should be pre-serialized here.
   */
  promptArgs?: (ctx: TickContext) => Record<string, string>;

  /**
   * Decides which sibling phases to wake based on this tick's result.
   * Returning an empty array means "no wake" (system may hibernate if all
   * baton flags are absent).
   */
  handoff: (result: TickResult) => string[];

  /**
   * Optional hook invoked after a fanout worktree is created, before the
   * agent runs. The chain config uses this to materialize gitignored files
   * the gates need — typically `node_modules` and `.env` — by symlinking
   * them from the main repo. Singleton phases run in the main repo and do
   * not invoke this.
   *
   * Returning `{ extraEnv }` injects those vars into the agent invocation
   * for this worktree, layered on top of the harness's `process.env`. Use
   * this when the worktree needs an ephemeral resource handle the chain
   * provisioned at setup time (per-worktree DATABASE_URL, scratch dir,
   * issued credential). Existing void-returning implementations are
   * unaffected.
   */
  setupWorktree?: (
    ctx: WorktreeSetupContext,
  ) => Promise<void | WorktreeSetupResult>;

  /**
   * Optional hook invoked after the agent exits and gates run, before the
   * worktree is removed. Mirrors `setupWorktree` for resource cleanup —
   * drop a per-worktree DB, release a lease, etc. Best-effort: failures
   * are logged but do not block worktree removal. The same ctx fields are
   * available as at setup time.
   */
  teardownWorktree?: (ctx: WorktreeSetupContext) => Promise<void>;
}

/** Context handed to Phase.setupWorktree after a fanout worktree is created. */
export interface WorktreeSetupContext {
  /** Path to the fresh worktree the tick will run in. */
  worktreePath: string;
  /** Path to the main repo root the worktree was created from. */
  repoRoot: string;
  /** Tag of the pending entry assigned to this worktree. */
  entryTag: string;
}

/** Optional return shape from Phase.setupWorktree. */
export interface WorktreeSetupResult {
  /**
   * Extra env vars to merge into the agent invocation env for this
   * worktree. Layered on top of the harness's `process.env`. Useful for
   * per-worktree DATABASE_URL, scratch paths, short-lived credentials —
   * anything the chain provisioned during setup that the agent (and
   * gates run inside the worktree) need at runtime without baking into
   * the worktree's tracked filesystem.
   */
  extraEnv?: Record<string, string>;
}

/**
 * A Chain is an ordered set of phases plus the rules for which phases
 * humans can wake manually (e.g. spec from a workshop session).
 */
export interface Chain {
  phases: Phase[];
  /**
   * Phases the dispatcher is forbidden to wake via another phase's handoff.
   * Humans can still wake them by touching `.flume/awake/<name>`. The
   * canonical example is `spec`, which derives from human-authored workshop
   * content and shouldn't be woken autonomously.
   */
  humanOnly: string[];
}
