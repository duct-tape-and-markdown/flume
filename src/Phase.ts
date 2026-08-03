/**
 * Phase — the declared shape of one step in a derivation chain.
 *
 * A Phase is data, not code. The Dispatcher (added later) consumes Phases to
 * decide what prompt to send, what to enforce post-commit, how to fan out,
 * and which sibling phases to wake.
 */

import type { Agent } from "./Agent.js";
import type { Gate } from "./Gate.js";
import type { EntryExtension, PendingEntry } from "./PendingSchema.js";
import type { NoCommitMode } from "./Prompt.js";

/**
 * Concurrency model for a phase:
 *
 * - "singleton": one tick at a time. Plan and spec phases must be singleton
 *   because they derive shared artifacts (the plan file, the spec corpus)
 *   that don't admit concurrent edits.
 *
 * - "fanout": the dispatcher picks N disjoint-by-Files: pending entries and
 *   runs N tick invocations in parallel worktrees. Build is the canonical
 *   fanout phase. Each entry's commit is cherry-picked onto the trunk and
 *   gated individually; an afterMerge gate failure reverts only that
 *   entry's commit, and the rest of the wave stays shipped.
 */
export type Concurrency = "singleton" | "fanout";

/**
 * Context handed to a phase's `promptArgs` builder when constructing the
 * agent invocation for one tick.
 */
export interface TickContext {
  /** Absolute path of the worktree this tick runs in. */
  cwd: string;
  /**
   * Absolute, resolved flume state root (`flumeDir`; default
   * `<repoRoot>/.flume`, relocatable via `FLUME_DIR`). Surfaced so a phase's
   * `promptArgs` can derive state-relative paths from it. The dispatcher also
   * auto-injects this as the reserved `{{FLUME_DIR}}` prompt arg, so most
   * prompts need no `promptArgs` boilerplate (RELEASE-v0.3 §16).
   */
  flumeDir: string;
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
  /**
   * RELEASE-v0.2 §6 no-commit classification, present iff the tick (or, for
   * a fanout wave, the whole wave) produced no usable commit. Absent on a
   * committed tick. A chain's `handoff` reads this to wake a sibling phase
   * on a voluntary-bail that `shippedTags`/`gateResults` alone can't
   * distinguish from a genuine nothing-pickable no-op.
   */
  noCommit?: NoCommitMode;
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
   * Agent that runs this phase's ticks. Per-tick resolution is
   * `phase.agent ?? chainModule.agent ?? DispatcherOptions.agent` — the
   * innermost scope of the existing chain-level override. An `Agent` value
   * (not a model string) so it composes with decorators; a model-only
   * variation is `claudeCode({ extraArgs: ["--model", "…"] })` inside this
   * value. Absent, the phase runs on the chain/dispatcher default.
   */
  agent?: Agent;

  /**
   * Glob patterns the phase is permitted to modify. Post-commit, the
   * harness diffs the commit against these patterns; violations revert
   * the commit. This replaces prose "You may NOT modify X" rules in prompts.
   *
   * Paths are relative to the repo root. Patterns are minimatch-style.
   */
  writablePaths: string[];

  /**
   * Globs always writable on an entry-scoped fanout tick, regardless of the
   * assigned entry's declared files — the channel allowance for cross-tick
   * artifacts an entry never declares (e.g. a build phase that reports
   * findings into `.flume/plan/open-questions.md`).
   *
   * Only consulted when `scopeWritesToEntry` is `true`. On such a tick
   * carrying an assignedEntry, the write guard narrows to the entry's
   * `files.{new,edit,retire}` paths ∪ these globs, with `writablePaths` as
   * the outer ceiling (both checks apply). Singleton ticks keep phase-wide
   * scope and ignore this regardless. Default `[]`.
   */
  entryChannelPaths?: string[];

  /**
   * Opt in to narrowing a fanout tick's write allowance to the assigned
   * entry (`declaredPaths(entry) ∪ entryChannelPaths`), with
   * `writablePaths` as the outer ceiling both checks apply against. Default
   * `false`: a scoped tick's write allowance and rendered prompt fence are
   * then byte-identical to a singleton tick's — `writablePaths` alone,
   * unconditionally enforced either way. Declaring `true` makes the
   * producer phase's `files` declaration a second, narrower permission on
   * top of that ceiling (spec/pending.md, *The entry-scoped write guard is
   * opt-in, and off by default*).
   */
  scopeWritesToEntry?: boolean;

  /** Gates that run at afterCommit / afterMerge points. */
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
   * Optional predicate the dispatcher consults before rendering the prompt
   * or invoking the agent (RELEASE-v0.11 §8) — a capability with an
   * injection point: the dispatcher supplies the skip, the chain supplies
   * the reason (`engine-boundary.md`, *Capability vs convention*).
   * Returning `false` ends the tick as a declined no-op: no agent
   * invocation, no commit, `handoff` still runs so the chain can pass the
   * baton on. Undeclared is unchanged behavior — a phase without
   * `shouldRun` always runs, byte-identically to a phase whose `shouldRun`
   * returns `true`.
   *
   * Sees the same `TickContext` `promptArgs` sees — no new plumbing. Must
   * be synchronous and cheap: it runs before every invocation, so I/O
   * belongs in the tick it would be trying to avoid.
   */
  shouldRun?: (ctx: TickContext) => boolean;

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
   * issued credential). A hook with no vars to inject returns `void` — the
   * result object is only needed to carry `extraEnv`.
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
   * anything the chain provisioned during setup that the agent needs at
   * runtime without baking into the worktree's tracked filesystem.
   * Scoped to the agent invocation only: gates spawn from the
   * dispatcher's own env and do not see these vars.
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
   * Chain-declared pending-entry extension (v0.8 §2): fields beyond the
   * engine core (tag/gate/dependsOnForks/files), each declared once with
   * its zod schema and prompt hint. The dispatcher composes the merged
   * validator from it; `renderSchemaForPrompt(extension)` composes the
   * rendered schema from the same declaration. Absent means bare core.
   */
  entryExtension?: EntryExtension;
  /**
   * Phases the dispatcher is forbidden to wake via another phase's handoff.
   * Humans can still wake them by touching `.flume/awake/<name>`. The
   * canonical example is `spec`, which derives from human-authored workshop
   * content and shouldn't be woken autonomously.
   */
  humanOnly: string[];
  /**
   * `configDir`-relative directory `flume job new` seeds a fresh job dir
   * from — the `promptPath` idiom (stubs are real files beside the chain,
   * e.g. `.flume/job-seed/`). Copied verbatim, skip-existing (re-run fills
   * gaps — a stub added to the seed dir reaches existing jobs — and never
   * clobbers a worked file). Absent means a bare job: no content opinion,
   * no warning.
   */
  seedDir?: string;
  /**
   * State-root-relative directory path naming the friction channel (e.g.
   * "friction") — loop-to-owner notes, gitignored, hand-routed by the
   * operator, never in a commit diff. Resolved against the resolved
   * `flumeDir` at load, same idiom as `seedDir`. Undeclared: every
   * friction-lifecycle behavior stays off, no default channel.
   */
  friction?: string;
  /**
   * Environment facts this chain asserts (v0.8 §4) — the strings a pending
   * entry's `gate: { kind: "requiresCapability", capability }` is matched
   * against. `chain.ts` is TypeScript, so this may probe the environment at
   * load time (e.g. a daemon health check succeeding asserts its name here).
   * Undeclared or omitted means no capability is asserted: a
   * `requiresCapability` entry stays non-pickable until the chain names it
   * here.
   */
  capabilities?: string[];
  /**
   * Override for the `flume loop` supervisor's provisioning-failure policy
   * (v0.7 §16, opened v0.8 §8) — the run-scoped quarantine and the
   * consecutive-identical-failure abort threshold ship as engine defaults;
   * this block lets a chain choose otherwise. Undeclared or omitted fields
   * fall through to the defaults in `src/Dispatcher.ts`'s
   * `SuperviseLoopOptions.quarantineScope`/`abortThreshold` docs, whose exact
   * byte shape is pinned by tests/Dispatcher.test.ts's "a chain declaring
   * neither knob gets the v0.7 §16 defaults, byte-identical" case.
   */
  supervisorPolicy?: {
    /**
     * `"run"` (default): a tagged pre-tick worktree-provisioning failure
     * quarantines that entry's slug for the rest of the run. `"none"`:
     * quarantine never engages — every entry stays pickable every tick
     * regardless of an earlier provisioning failure. The
     * consecutive-identical-failure backstop (`abortThreshold`) applies
     * either way.
     */
    quarantineScope?: "run" | "none";
    /**
     * Number of consecutive ticks the same provisioning-failure signature
     * must repeat, with no successful tick between them, before the
     * supervisor aborts the run. Default 3.
     */
    abortThreshold?: number;
  };
}
