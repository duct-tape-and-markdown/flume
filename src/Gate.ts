/**
 * Gate — a composable harness check. Runs at a declared point in the tick
 * lifecycle and reports ok/fail with a message the dispatcher can surface
 * back to the agent on retry.
 *
 * Gates are how prose-validation moves out of prompts. A phase declares its
 * gates; the harness runs them; the prompt never reminds the agent to.
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

export interface GateContext {
  /** Absolute path of the worktree (or trunk for postMerge gates). */
  cwd: string;
  /** Phase the gate is running for. */
  phaseName: string;
  /** SHA of the commit under inspection. */
  commitSha?: string;
  /** Logger for harness-side output. Gates should not write to stdout directly. */
  log: (line: string) => void;
}

export interface GateResult {
  ok: boolean;
  /** Short summary surfaced to the dispatcher and (on failure) the agent. */
  message: string;
  /** Optional captured output (e.g. tsc stderr) for context injection. */
  details?: string;
}

export interface Gate {
  /** Stable identifier; appears in logs and gate-failure prompt context. */
  name: string;
  /** When in the lifecycle this gate runs. */
  when: GatePhase;
  /** The check itself. Must be pure-ish; idempotent; no commits or pushes. */
  run: (ctx: GateContext) => Promise<GateResult>;
}
