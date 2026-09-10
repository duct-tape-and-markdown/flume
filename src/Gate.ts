/**
 * Gate — a composable harness check. Runs at a declared point in the tick
 * lifecycle and reports ok/fail with a message the dispatcher can surface
 * back to the agent on retry.
 *
 * Gates are how prose-validation moves out of prompts. A phase declares its
 * gates; the harness runs them; the prompt never reminds the agent to.
 */

import type { PendingEntry } from "./PendingSchema.js";

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
   * Runs after a worktree commit is cherry-picked onto the trunk — a fanout
   * entry's, or a singleton phase's own (spec/worktrees.md, "Singleton runs
   * in a worktree"). Failure reverts only that commit; for a fanout wave,
   * the rest of the wave stays shipped.
   */
  | "afterMerge";

/**
 * Inputs passed to every gate at run time. The dispatcher constructs this
 * once per gate invocation; gates should treat it as read-only and confine
 * side effects to disk operations inside `cwd`.
 */
export interface GateContext {
  /** Absolute path of the worktree (or trunk for afterMerge gates). */
  cwd: string;
  /**
   * Absolute, resolved flume state root (`flumeDir`) — where the baton,
   * pending, worktrees, and prior-attempts live (default `<repoRoot>/.flume`,
   * relocatable via `FLUME_DIR`). A gate reads state-relative paths from here
   * (`join(ctx.flumeDir, "plan", "pending.json")`) instead of hardcoding
   * `.flume/` or reaching into `process.env` (RELEASE-v0.3 §16).
   *
   * This is the **primary checkout's** state root at both gate points, never
   * rebased onto a worktree: runtime state (`awake/`, `prior-attempts/`,
   * `tick-verdicts.jsonl`) exists only there. Under `afterCommit` it is
   * therefore *not* nested under `repoRoot` — the worktree lives inside it —
   * so a gate never derives a repo-relative path from `flumeDir` and
   * `repoRoot` directly; use `stateRootRel` for that (spec/chain.md "What a
   * gate receives").
   */
  flumeDir: string;
  /**
   * `flumeDir`'s path relative to the primary repo root, set when the state
   * root lives inside the repo and absent when it is relocated outside it
   * (an absolute `FLUME_DIR`, or one that climbs out via `..`). The one value
   * a gate needs to read a **tracked** state-root file as a given commit
   * held it — `git show <commitSha>:<stateRootRel>/plan/pending.json` —
   * without hardcoding `.flume` or re-deriving the offset itself. Computed
   * once by the dispatcher and shared with its own friction-harvest use of
   * the same offset (`.claude/rules/engineering.md` "The fix lands at the
   * mechanism"). Optional so hand-built `GateContext` fixtures that predate
   * this field keep compiling; every dispatcher-constructed context sets it
   * (to a string, or explicitly to `undefined` when the state root is
   * relocated).
   */
  stateRootRel?: string | undefined;
  /**
   * Absolute path of the chain/prompts dir (`<configDir>/chain.ts`, default
   * `<repoRoot>/.flume`, relocatable via `FLUME_CONFIG_DIR`, spec/cli.md
   * "State-root and config-dir resolution"). Rebased onto the gate's own
   * `cwd` when that differs from the primary checkout (an `afterCommit`
   * gate runs inside the tick's worktree, which mirrors the repo's tracked
   * layout at the same relative offset) — but only while the config dir
   * resolves *inside* the repo. One relocated outside it has no mirror in a
   * checkout that carries only tracked files, so it passes through
   * verbatim; the escape test that picks the branch is
   * `computeStateRootRel`'s, the same owner `stateRootRel` above reads.
   * Either way a gate reads `ctx.configDir` directly instead of hardcoding
   * `.flume` or reaching into `process.env`
   * (`.claude/rules/engine-boundary.md` "Told, not inferred").
   */
  configDir: string;
  /**
   * Absolute, resolved path to the pending queue (`Chain.pendingPath`,
   * default `<flumeDir>/plan/pending.json`), resolved once per tick by the
   * dispatcher — same idiom as `flumeDir`/`configDir`. A gate reads this
   * instead of hardcoding `plan/pending.json` (spec/pending.md, "`pendingGate`
   * — validation and fence pre-check as an opt-in builtin").
   */
  pendingPath: string;
  /**
   * Absolute path of the working-tree root the gate is running in — for an
   * `afterCommit` gate, the worktree root (a fanout entry's, or a singleton
   * phase's own; spec/worktrees.md "Singleton runs in a worktree"); for an
   * `afterMerge` gate, the trunk (RELEASE-v0.7 §6).
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
  /**
   * The sha the gated span started from — the worktree's tip when the tick
   * branched, the same value the dispatcher cherry-picks the span from. Set
   * at both stages: under `afterCommit` it is the base of the span being
   * gated in the worktree; under `afterMerge` it is that same base, not the
   * pre-cherry-pick trunk tip, so a gate reading trunk can tell an input the
   * tick *ignored* from one it *never saw* — `git log <baseSha>..HEAD --
   * <inputs>` names what landed after the tick branched, and
   * `git show <baseSha>:<path>` is the input as the tick read it
   * (spec/chain.md "What a gate receives"). Without it a chain rebuilds the
   * base from a worktree path convention the engine never promised. Optional
   * for the same hand-built-fixture reason as `commitSha`/`touchedPaths`
   * above; every dispatcher-constructed context sets it.
   */
  baseSha?: string;
  /**
   * The pending entry this span was provisioned for, as the wave selected it
   * — set at both stages under fanout, absent on a singleton tick, which
   * carries no entry (spec/chain.md "What a gate receives"). A chain gate
   * reads its extension fields (`tests[]`, an acceptance) through the
   * chain's own schema to hold the commit to the entry's own contract; the
   * engine reads none of them. Reported from the value the dispatcher
   * already holds for the scoped fence, never re-read from the queue.
   */
  entry?: PendingEntry;
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
  /**
   * Repo-relative paths the gate attributes the failure to, when its runner
   * can name them (a test reporter's JSON, a type-checker's diagnostics).
   * When present alongside the reverted span's own touched paths, the
   * dispatcher derives the suspect-flake marker on the prior-attempt record
   * mechanically, from list disjointness — never from this gate's prose
   * (spec/chain.md "What a gate returns"). Absent is today's behavior: no
   * marker, no inference. No builtin gate populates this yet.
   */
  failingFiles?: string[];
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
  /**
   * The single command line this gate runs, when it has one — `shellGate`
   * sets it from its `cmd`/`args`, so a chain wanting the agent to
   * self-check before committing doesn't restate the command in its prompt
   * from a parallel constant (`spec/chain.md`, "The builtin gates"). A
   * hand-rolled gate with no single command line (`chainLoadGate`,
   * `pendingGate`, `writablePathsGate`) declares none.
   */
  command?: string;
}
