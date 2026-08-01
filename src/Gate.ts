/**
 * Gate — a composable harness check. Runs at a declared point in the tick
 * lifecycle and reports ok/fail with a message the dispatcher can surface
 * back to the agent on retry.
 *
 * Gates are how prose-validation moves out of prompts. A phase declares its
 * gates; the harness runs them; the prompt never reminds the agent to.
 */

/**
 * When in the tick lifecycle a gate runs. `afterCommit` is the common case
 * (validate the agent's commit on its worktree branch); `afterMerge` runs
 * on the trunk after a fanout phase's wave lands.
 */
export type GatePhase =
  /**
   * Runs after the agent's commit lands on the worktree branch, before the
   * harness accepts it. Failure drops the commit (worktree branch is reset)
   * and (for fanout phases) the entry is left in pending for the next plan.
   */
  | "afterCommit"
  /**
   * Runs after a fanout phase's worktree branches merge into the trunk.
   * Failure reverts the merge wave on the trunk. Singleton phases never
   * run afterMerge gates because they commit directly to the trunk.
   */
  | "afterMerge";

/**
 * Inputs passed to every gate at run time. The dispatcher constructs this
 * once per gate invocation; gates should treat it as read-only and confine
 * side effects to disk operations inside `cwd`.
 */
export interface GateContext {
  /** Absolute path of the worktree (or trunk for postMerge gates). */
  cwd: string;
  /**
   * Absolute, resolved flume state root (`flumeDir`) — where the baton,
   * pending, worktrees, and prior-attempts live (default `<repoRoot>/.flume`,
   * relocatable via `FLUME_DIR`). A gate reads state-relative paths from here
   * (`join(ctx.flumeDir, "plan", "pending.json")`) instead of hardcoding
   * `.flume/` or reaching into `process.env` (RELEASE-v0.3 §16).
   */
  flumeDir: string;
  /**
   * Absolute path of the working-tree root the gate is running in — in a
   * fanout tick, the worktree root; in a bare tick, the primary checkout
   * (RELEASE-v0.7 §6).
   */
  repoRoot: string;
  /** Phase the gate is running for. */
  phaseName: string;
  /** SHA of the commit under inspection. */
  commitSha?: string;
  /**
   * The commit's changed paths (relative to repo root, forward-slash),
   * computed once per commit by the dispatcher via `git.showNameOnly` and
   * shared across every gate this tick runs. A gate that needs touched-path
   * detection reads this instead of shelling `git show --name-only` out on
   * its own (engineering.md "The fix lands at the mechanism"). Optional so
   * hand-built `GateContext` fixtures that predate this field keep
   * compiling; every dispatcher-constructed context sets it.
   */
  touchedPaths?: string[];
  /** Logger for harness-side output. Gates should not write to stdout directly. */
  log: (line: string) => void;
}

/**
 * What a gate reports back. `message` is the one-line verdict shown to the
 * dispatcher (and forwarded to the agent on failure context); `details`
 * carries any captured stdout/stderr for richer surfacing.
 */
export interface GateResult {
  ok: boolean;
  /** Short summary surfaced to the dispatcher and (on failure) the agent. */
  message: string;
  /** Optional captured output (e.g. tsc stderr) for context injection. */
  details?: string;
}

/**
 * The declared shape of one validation step. Gates are data the dispatcher
 * runs at the declared `when` point in the lifecycle; the prompt never
 * needs to remind the agent to run them.
 */
export interface Gate {
  /** Stable identifier; appears in logs and gate-failure prompt context. */
  name: string;
  /** When in the lifecycle this gate runs. */
  when: GatePhase;
  /** The check itself. Must be pure-ish; idempotent; no commits or pushes. */
  run: (ctx: GateContext) => Promise<GateResult>;
}
