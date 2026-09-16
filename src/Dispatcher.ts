/**
 * Dispatcher — the runtime. Reads baton, picks the awake phase, builds the
 * TickContext, invokes the agent, runs gates, decides handoff.
 *
 * One Dispatcher instance per repo. Stateless across ticks (everything it
 * needs comes from disk). `tick()` runs exactly one phase × one (or N for
 * fanout) agent invocation(s). The outer loop that repeats `tick()` until
 * hibernation is a process-per-tick supervisor of its own
 * (`superviseLoop`, `src/loopSupervisor.ts`), the retry's input — the
 * prior-attempt records this file writes and reads back — lives in
 * `src/priorAttempts.ts`, the friction channel it validates, counts
 * and harvests lives in `src/friction.ts`, and the ephemeral worktrees it
 * provisions, tears down and sweeps live in `src/worktrees.ts`.
 *
 * The work between the baton read and the verdict is the phase's
 * concurrency's, and each concurrency is a file: the singleton leg
 * (`src/singletonTick.ts`) and the wave leg (`src/waveTick.ts`), which read
 * what this class resolved through one context (`src/tickLeg.ts`).
 *
 * What a tick reads and writes, each in the file its name is: which entries
 * of the queue it may pick and the batch a wave carries off it
 * (`src/selection.ts`), the one agent attempt both concurrencies make and the
 * `shouldRun` consult that precedes it (`src/tickAttempt.ts`), the single
 * call site a declared gate runs through (`src/gateRun.ts`), the facts
 * artifact it builds and the vocabularies that artifact carries
 * (`src/tickVerdict.ts`), the two checks it takes around the trunk it moves
 * (`src/tipVerify.ts`), the interrupted-merge markers a wave stakes around a
 * cherry-pick (`src/mergingMarkers.ts`), the chain resolution that starts a
 * tick (`src/chainLoad.ts`), the logging seam it narrates through
 * (`src/log.ts`), and the exit codes the `flume tick` process boundary
 * carries (`src/exitCodes.ts`).
 *
 * What stays here is the orchestration around those: the baton read, the
 * chain load, the dispatch to a leg, the verdict each leg reports in, the
 * queue's own reads, and the preview (`render`) of the tick that would run.
 */

import { readFile } from "node:fs/promises";
import { relative, isAbsolute, sep } from "node:path";

import type { Agent } from "./Agent.js";
import { Baton } from "./Baton.js";
import {
  CjsContextLoadError,
  diskChainLoader,
  resolveWorktreesBaseDeclaration,
  type ChainModule,
} from "./chainLoad.js";
import type { FlumePaths } from "./flumeApi.js";
import type { GateRunScope } from "./gateRun.js";
import { existsLoud } from "./fsProbe.js";
import { consoleLogger, type Logger } from "./log.js";
import {
  gitPath,
  defaultStateRoot,
  namespacedJoin,
  phasePromptPath,
  resolvePendingPath,
} from "./paths.js";
import { DEFAULT_KILL_GRACE_MS } from "./processTree.js";
import { PriorAttemptStore } from "./priorAttempts.js";
import { parsePending, PendingParseFailure } from "./PendingSchema.js";
import type { EntryExtension, PendingEntry } from "./PendingSchema.js";
import type { Chain, TickContext, TickResult } from "./Phase.js";
import { renderPrompt } from "./Prompt.js";
import type { NoCommitMode } from "./Prompt.js";
import { selectBatch, type BatchSelection } from "./selection.js";
import { runSingleton } from "./singletonTick.js";
import type { AgentBounds, AttemptContext } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import {
  throwFacts,
  type GateFailure,
  type MergeFailure,
  type ProvisionFailure,
  type TickVerdict,
} from "./tickVerdict.js";
import * as git from "./git.js";
import { runFanout, WaveLedgerParseFailure } from "./waveTick.js";
import {
  sweepStaleWorktrees,
  type WorktreeContext,
} from "./worktrees.js";

/**
 * The one name this module still re-exports rather than holds, and a
 * declared divergence from "the split moves the job" rather than residue:
 * `ChainFactory` lives with the load it types (`src/chainLoad.ts`), and its
 * declared home for a consumer is the package surface (`src/index.ts`, what
 * `@dtmd/flume` resolves to). This repo's own `.flume/chain.ts` deep-imports
 * it from here instead, and `.flume/` is outside every autonomous phase's
 * writable paths, so no plan or build tick can respell that import.
 *
 * Retired by an interactive session, in the commit that repoints
 * `.flume/chain.ts` at `../src/index.ts` — the spelling every other consumer
 * already uses; this line goes with it.
 */
export type { ChainFactory } from "./chainLoad.js";

/**
 * The state root's path relative to the primary repo root **in git's own
 * alphabet** ({@link gitPath}, `src/paths.ts`), or `undefined` when the state
 * root is relocated outside it (climbs out via `..`, or is already absolute —
 * a relocated `flumeDir` set by an absolute `FLUME_DIR`).
 *
 * The fold lands here, at the one reporter, because every consumer of this
 * value composes a path git will name — a pathspec at a sha, a fence glob, a
 * commit's touched path. `relative` answers in the host's dialect, so
 * reporting it raw makes the conversion each reader's problem and puts a
 * sibling path in the other alphabet the first time one reader forgets.
 * Computed once, from the two roots that never change after construction,
 * and shared by every `GateContext.stateRootRel` and by `harvestFriction`'s
 * own worktree-mirror check (`src/friction.ts`; spec/chain.md "What a gate
 * receives"). Two
 * further consumers call it with a different second root, each a path whose
 * escape status decides whether a worktree holds a mirror of it:
 * `isPendingRelocated` passes `pendingPath` — a descendant of the state root
 * (`resolvePendingPath`, `src/paths.ts`) whose escape status against
 * `repoRoot` always matches `flumeDir`'s own — and the `afterCommit`
 * gate-context build passes `configDir`, rebasing it onto the worktree only
 * when it resolves inside the repo. None re-derives the check
 * (`.claude/rules/engineering.md` "The fix lands at the mechanism").
 */
export function computeStateRootRel(
  repoRoot: string,
  flumeDir: string,
): string | undefined {
  const rel = relative(repoRoot, flumeDir);
  const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  return outside ? undefined : gitPath(rel);
}

/**
 * Derive {@link AgentBounds} from a chain's declaration, the embedder's
 * `tickTimeoutMs` below it. Taken once per tick rather than at each of the two
 * legs that invoke an agent, which would be the same fallback chain spelled
 * twice (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
function resolveAgentBounds(
  policy: Chain["supervisorPolicy"],
  fallbackTimeoutMs: number | undefined,
): AgentBounds {
  const timeoutMs = policy?.tickTimeoutMs ?? fallbackTimeoutMs;
  const killGraceMs = policy?.killGraceMs;
  return {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(killGraceMs !== undefined ? { killGraceMs } : {}),
  };
}

/**
 * Constructor input for `Dispatcher`. `repoRoot`, `configDir`, and `agent`
 * are required; the rest tune chain resolution, concurrency, trunk
 * identification, logging, and per-tick wall-clock budget.
 *
 * No prebuilt `Chain` is accepted — the dispatcher resolves
 * `<configDir>/chain.ts` once at the start of its tick. Re-resolution across
 * ticks is a process boundary, not in-process: `flume loop` spawns one
 * `flume tick` per iteration, so a tick that rewrites the chain is
 * governed by the new chain on the next tick's fresh process.
 */
export interface DispatcherOptions {
  repoRoot: string;
  /** Directory the chain config (and its prompt files) live in. */
  configDir: string;
  /**
   * Mutable-state root: where the baton (`awake/`), pending
   * (`plan/pending.json`), worktrees (`worktrees/`), and prior-attempt records
   * (`prior-attempts/`) live. Defaults to `<repoRoot>/.flume` — the historical
   * fixed location. Relocate it to run a fully self-contained, ephemeral
   * harness whose entire footprint can be removed in one `rm` (the
   * attach-work-detach posture: state never bleeds into `<repoRoot>/.flume`).
   * Independent of `configDir`; set both to the same dir to co-locate config
   * and state.
   */
  flumeDir?: string;
  /**
   * Fanout branch namespace. When set, ephemeral worktree branches
   * are `flume/<namespace>/<slug>` instead of the repo-global `flume/<slug>`,
   * and worktree paths are `<wtBase>/<namespace>/<slug>` instead of
   * `<wtBase>/<slug>`, so two jobs whose pending entries share a tag slug fan
   * out onto disjoint branches AND disjoint paths (a shared
   * FLUME_WORKTREES_DIR would otherwise clobber). Resolved by the CLI from
   * `FLUME_JOB` and passed down explicitly — the dispatcher never sniffs
   * `flumeDir` for a job name.
   */
  namespace?: string;
  /**
   * Default agent. Per-tick resolution is
   * `phase.agent ?? chainModule.agent ?? this` — a `chain.ts` whose factory
   * returns `agent` overrides this (the agent re-resolves with the chain),
   * and a phase carrying its own `agent` overrides both for its ticks.
   */
  agent: Agent;
  /**
   * Chain resolver, invoked once per tick. Defaults to
   * `diskChainLoader` over this dispatcher's own resolved roots (one load
   * of `<configDir>/chain.ts` per process). Override for in-process test
   * injection only (no subprocess).
   */
  chainLoader?: () => Promise<ChainModule>;
  /**
   * Foundations governor. Given the repo root, returns a predicate
   * answering "is this fork slug resolved?". Consulted once per tick;
   * an entry whose `dependsOnForks` contains any unresolved slug is not
   * pickable, skipped in favour of a foundation-settled sibling (or the tick
   * idles if none). Default: every fork resolved — a chain that supplies no
   * resolver never holds an entry back. The runtime stays
   * format-agnostic: how a project records and resolves forks lives in the
   * resolver, not here.
   */
  forkResolver?: (repoRoot: string) => (slug: string) => boolean;
  log?: Logger;
  /**
   * Max parallel ticks per fanout batch. Default 4. Overridable per chain via
   * `Chain.supervisorPolicy.maxParallel` (`src/Phase.ts`), which `runFanout`
   * prefers when declared — this option is the fallback below it, for a
   * programmatic embedder that wants a floor the chain doesn't set.
   */
  maxParallel?: number;
  /**
   * Wall-clock timeout per agent invocation in milliseconds. When exceeded,
   * the underlying agent process is aborted; the dispatcher logs a warning
   * and the tick continues with whatever the agent committed (typically
   * nothing, so the phase falls through with `committed: false`). Default:
   * unset — a hung agent will block the tick indefinitely. Overridable per
   * chain via `Chain.supervisorPolicy.tickTimeoutMs` (`src/Phase.ts`), which
   * `runAttempt` prefers when declared, for either concurrency — this
   * option is the fallback below it, for a programmatic embedder that wants
   * a cap the chain doesn't set.
   */
  tickTimeoutMs?: number;
  /**
   * This run's teardown, reaching the agent seam: aborting it aborts the
   * in-flight invocation, which takes the agent's whole process tree down and
   * settles once that tree is gone ({@link AgentInvocation.signal}). The
   * `flume tick` command supplies its own controller's signal and awaits
   * `tick()` before it releases the tip claim and exits, so a signalled bare
   * tick leaves no writer inside the state root the claim protected
   * (spec/loop.md, "The loop lock and the tip claim"). Default: unset — a
   * dispatcher nobody can stop, which is every embedder that never wired one.
   */
  stopSignal?: AbortSignal;
  /**
   * {@link quarantineKey} values (`slug@hash`) excluded
   * from this tick's fanout pick even though `pending.json` still lists them
   * as pickable — `pending.json` itself is untouched. The `flume loop`
   * supervisor populates this (via the `tick` command's
   * `FLUME_QUARANTINED_SLUGS` env var, whose name predates the key and
   * stands) from entries whose provision/merge/gate stage failed earlier in
   * the run; the exclusion is run-scoped only — a fresh run/process always
   * starts with nothing quarantined. Because the key covers the entry's
   * bytes, an entry re-scoped on trunk no longer matches the held key and
   * is pickable again without a relaunch. Default: nothing quarantined.
   */
  quarantinedSlugs?: ReadonlySet<string>;
  /**
   * spec/loop.md "The loop lock and the tip claim": the pid of the tip
   * claim *this run* operates under — its own (a bare `flume tick`, which
   * acquires directly in-process, so this equals `process.pid`) or its
   * supervisor's (a loop-spawned child, told via `FLUME_TIP_CLAIM_HELD`).
   * `liveForeignClaimPid` (the wave's own tip-verify check, consulted before
   * every cherry-pick and before the pending-ledger commit) excludes a live
   * claim matching this pid — without it, a run's own claim reads as a
   * concurrent engine instance to its own wave, which refuses every
   * cherry-pick against itself. Per .claude/rules/engine-boundary.md "Told,
   * not inferred": the CLI states which pid is self; the dispatcher never
   * guesses from a bare pid match, which a unit test constructing a
   * `Dispatcher` directly (no real claim of its own) relies on to keep
   * simulating a genuinely foreign claim. Default: unset — every live claim
   * reads as foreign, unchanged behavior for a caller that never acquired
   * one.
   */
  ownTipClaimPid?: number;
  /**
   * Override for the pending-ledger commit's message
   * (.claude/rules/engine-boundary.md "Capability vs convention").
   * `commitPendingUpdate` calls this with the tags shipped this wave (empty
   * when the wave only recorded merge-failure footprints) and the tags whose
   * footprints were recorded, and commits pending.json with whatever string
   * it returns. The `chore(flume): ship ...` /
   * `chore(flume): record merge-failure footprints for ...` wording is this
   * harness's own convention, not something every chain need adopt.
   * Default (omitted): reproduces that exact text.
   */
  commitMessage?: (
    shippedTags: readonly string[],
    footprintTags: readonly string[],
  ) => string;
}

/**
 * Axis-C terminal misconfiguration: the declared world is inconsistent —
 * deterministic, non-retryable, no agent ran. `kind` is a union open to
 * future Axis-C members; `"orphaned-awake"` (awake flags naming phases the
 * chain does not declare) is its founding member.
 */
export interface TerminalMisconfiguration {
  kind: "orphaned-awake";
  /** The awake-flag names the chain does not declare. Flags stay on disk. */
  phases: string[];
}

/**
 * Per-tick summary returned by `Dispatcher.tick()`. The loop inspects
 * `hibernated` to decide when to exit; `summary` is the one-liner the
 * dispatcher surfaces through the logger after each tick.
 */
export interface TickOutcome {
  hibernated: boolean;
  phaseName?: string;
  result?: TickResult;
  /**
   * True when the tick could not run at all — chain resolution threw and no
   * `chainLoadGate` reverted the producing commit: the mount-dead
   * failure class. The `flume tick` process exits
   * {@link EX_MOUNT_DEAD}; the `flume loop` supervisor fail-fasts on it
   * (aborting the run) rather than proceeding to the next tick — a mount-dead
   * chain is exactly as dead next tick as this one. Distinct from
   * `hibernated` (clean stop) and from a no-commit tick (the agent ran but
   * produced or kept no commit).
   */
  failed?: boolean;
  /**
   * Set when chain resolution failed with the CJS-context
   * signature — a usage error (the host repo's package.json is missing
   * `"type": "module"`) with a concrete, nameable fix, not a mount-dead
   * chain nothing can retry. `flume tick` exits 2 (usage), never
   * {@link EX_MOUNT_DEAD}; sibling to `failed`, mutually exclusive with it —
   * this is the one chain-resolution failure that isn't `failed`.
   */
  usageError?: boolean;
  /**
   * For a no-commit tick: which of the
   * four causally-distinct modes produced no usable commit —
   *  - `gate-revert`      a commit was made then a gate reverted it,
   *  - `clean-exit`       the agent exited cleanly without committing —
   *                       what that meant is the chain's reading of the
   *                       recorded final message, never an engine label,
   *  - `platform-preempt` the agent process failed for non-work reasons
   *                       (rate-limit, auth, timeout, dispatcher-killed) —
   *                       NOT a defect in the work,
   *  - `render-refused`   the prompt itself never resolved (an inline-exec
   *                       span failed) — the agent was never invoked at all.
   * Absent when the tick shipped a usable commit, hibernated, `failed`
   * (chain resolution threw), or ran no agent because nothing was pickable
   * (as opposed to `render-refused`, where an agent invocation was
   * attempted and the render itself is what failed). For a fanout wave it
   * is the representative cause when the whole wave shipped nothing
   * (precedence gate-revert > render-refused > platform-preempt >
   * clean-exit — the harm being guarded is platform failures masquerading
   * as agent failures, so platform-preempt outranks clean-exit in the wave
   * summary; render-refused is a real defect in the prompt/config, ranked
   * above the two non-defect classes); each entry's own mode is persisted
   * to its prior-attempt record, the durable per-entry channel for telling
   * clean-exit loops from platform-preempt runs without reading session
   * logs.
   */
  noCommit?: NoCommitMode;
  /**
   * Mirrors {@link TickVerdict.tipMoved} — set when this
   * tick hit the tip-verify backstop and refused a commit, from either of
   * its two producers: a live foreign claim on the ref before a
   * harness-driven commit (a concurrent engine instance), or a recorded
   * base that is no longer an ancestor of the HEAD the agent left on its
   * private branch. Neither leg compares the ref against a tip recorded at
   * tick start. A sibling fact to `noCommit` above, never a fifth
   * `NoCommitMode`: the tip-verify backstop is a harness-mechanical
   * refusal, not a cause the four causally-distinct modes classify.
   */
  tipMoved?: boolean;
  /**
   * Set when this tick refused to invoke the agent
   * because `phase.shouldRun` returned `false` — a sibling fact to
   * `noCommit`/`tipMoved`, never a fifth `NoCommitMode`: the chain declined
   * the tick before rendering the prompt, so there is no agent termination
   * to classify and no ref race to blame. Distinguishable from
   * `clean-exit` (the agent ran and committed nothing) and from `hibernated`
   * (nothing was awake) — a supervisor must be able to tell "the chain
   * declined" from "the agent ran and committed nothing" without reading
   * session logs.
   */
  declined?: boolean;
  /**
   * Axis-C terminal misconfiguration — sibling of `hibernated` /
   * `failed`, never a `NoCommitMode` member (no agent ran, no entry exists
   * to retry). Set when every awake flag names a phase the chain does not
   * declare. The flags are deliberately left on disk: clearing them would
   * convert the misconfiguration into a silent clean stop. `flume tick`
   * exits {@link EX_TERMINAL_MISCONFIG} when this is set.
   */
  terminal?: TerminalMisconfiguration;
  /**
   * Pre-tick worktree provisioning failures (sweep or
   * create) this fanout tick recorded, before any agent ran for the
   * affected entries. Distinct from `noCommit` — a provisioning failure
   * never reaches agent invocation, so it is not a no-commit mode; a
   * tick can carry both (this entry's provisioning failed while its
   * siblings ran and shipped) or `provisionFailures` alone with
   * `noCommit` unset (every other entry shipped, so the wave itself
   * committed). Present only when the tick hit at least one; absent on a
   * singleton tick or a clean fanout wave.
   */
  provisionFailures?: ProvisionFailure[];
  /**
   * See {@link TickVerdict.mergeFailures}.
   * Present only when the tick hit at least one; absent on a singleton tick or
   * a fanout wave with no cherry-pick conflict.
   */
  mergeFailures?: MergeFailure[];
  /**
   * See {@link TickVerdict.gateFailures}.
   * Present only when the tick hit at least one; absent on a clean tick.
   */
  gateFailures?: GateFailure[];
  /**
   * This tick's unified facts artifact, present iff a phase
   * actually ran (same condition as `result`) — absent on `hibernated`,
   * `usageError`, or `terminal`. One exception on `failed`: a fanout wave
   * whose `commitPendingUpdate` rewrite hit a `PendingParseFailure`
   * (`WaveLedgerParseFailure`) still ran a phase and shipped tags onto trunk
   * before the ledger rewrite refused, so `failed: true` carries `verdict`
   * too in that one case — every other `failed` path (chain resolution, a
   * decide-read parse failure with no agent run) carries none. The CLI's
   * `tick` command persists this via `writeTickVerdict`; `Dispatcher.tick()`
   * never writes the verdict itself, so a plain unit test calling it directly
   * gains no verdict file (the tick's own records — prior attempts, rendered
   * prompts — land under `flumeDir` as always).
   */
  verdict?: TickVerdict;
  /** Phase names awake after this tick. */
  awakeAfter: string[];
  /** One-line summary suitable for log output. */
  summary: string;
}

/**
 * What to resolve a preview for: a phase the chain declares, and — under
 * fanout — which queue entry to scope it to. `entryTag` omitted leaves the
 * selection to {@link Dispatcher.render}'s own batch arithmetic, exactly as a
 * tick makes it.
 */
export interface RenderRequest {
  phase: string;
  entryTag?: string;
}

/**
 * What {@link Dispatcher.render} resolved. Facts, never a verdict
 * (`.claude/rules/engine-boundary.md`, *Routing rule*): the caller decides
 * what to print and what to exit with.
 */
export interface RenderResolution {
  /** The phase, as the chain spells it. */
  phaseName: string;
  /**
   * The entry the render was scoped to — the one `--entry` named, or the one
   * the next wave's first batch carries first. Absent for a singleton phase,
   * which picks from no queue.
   */
  entry?: PendingEntry;
  /**
   * The same pickability verdict the tick's own selection takes, over the
   * queue at HEAD. Reported so a caller naming an entry by hand is told
   * whether a tick would carry it, rather than re-deriving the gate switch.
   */
  pickable: readonly PendingEntry[];
  /** The rendered prompt, byte-for-byte what the agent would be handed. */
  prompt: string;
}

/**
 * A render request the surface cannot honor as typed: an unknown phase, an
 * `--entry` on a phase that picks nothing, a tag no queue entry carries, or a
 * fanout phase with nothing pickable and no tag named. Usage-shaped
 * (spec/cli.md, *Subcommand surface*) — the caller maps it to exit 2.
 */
export class RenderUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderUsageError";
  }
}

/**
 * A render that reached the prompt and could not resolve it: a `promptArgs`
 * hook that threw. The tick's own name for this class is `render-refused`
 * (`NO_COMMIT_MODES`, `src/Prompt.ts`) — the agent is never invoked either
 * way; here there is simply no invocation to skip. An unresolved inline-exec
 * span is the same class and keeps its own richer type,
 * {@link InlineExecRenderError}, which names every failing span.
 */
export class RenderUnresolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderUnresolvedError";
  }
}

/**
 * Runtime that wires baton + chain + agent + gates into one tick. Stateless
 * across ticks (everything it needs comes from disk). `tick()` runs exactly
 * one phase × one invocation (or N for fanout); `superviseLoop`
 * (`src/loopSupervisor.ts`) repeats it in a fresh child process until
 * hibernation or `maxTicks`.
 */
export class Dispatcher {
  private readonly opts: DispatcherOptions;
  private readonly baton: Baton;
  /** Prior-attempt records: read, write, clear, and the revert snapshots. */
  private readonly attempts: PriorAttemptStore;
  private readonly log: Logger;
  private readonly maxParallel: number;
  private readonly tickTimeoutMs: number | undefined;
  private readonly flumeDir: string;
  private readonly stateRootRel: string | undefined;
  /** The roots this dispatcher resolved, as the chain factory receives them. */
  private readonly paths: FlumePaths;
  /**
   * `Chain.worktreesBase` evaluated, for the chain this dispatcher last
   * loaded — `undefined` until one is loaded, and whenever the chain
   * declares none. Held rather than re-evaluated per worktree, which is what
   * "evaluated at load" buys (spec/worktrees.md, *Placement*).
   */
  private chainWorktreesBase: string | undefined;
  private pendingPath: string;
  private readonly chainLoader: () => Promise<ChainModule>;
  /** Set when tick() loads the chain; composes pending parses. */
  private entryExtension: EntryExtension | undefined;
  /**
   * What the chain this dispatcher last loaded declared about its agent
   * invocations, reported through {@link agentKillGraceMs}. Initialized to
   * the constructor's own fallbacks, which is what a dispatcher that has
   * resolved no chain yet would apply.
   */
  private bounds: AgentBounds;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.flumeDir = opts.flumeDir ?? defaultStateRoot(opts.repoRoot);
    this.stateRootRel = computeStateRootRel(opts.repoRoot, this.flumeDir);
    this.baton = new Baton(this.flumeDir);
    this.log = opts.log ?? consoleLogger;
    this.paths = {
      repoRoot: opts.repoRoot,
      configDir: opts.configDir,
      flumeDir: this.flumeDir,
    };
    this.attempts = new PriorAttemptStore(
      this.flumeDir,
      opts.repoRoot,
      this.log,
    );
    this.maxParallel = opts.maxParallel ?? 4;
    this.tickTimeoutMs = opts.tickTimeoutMs;
    this.bounds = resolveAgentBounds(undefined, this.tickTimeoutMs);
    this.pendingPath = resolvePendingPath(this.flumeDir);
    this.chainLoader = opts.chainLoader ?? diskChainLoader(this.paths);
  }

  /**
   * This dispatcher's view of itself for `src/worktrees.ts` — the repo root,
   * state root, that root's relative path, the job namespace, the logger the
   * worktree lifecycle reads, and the chain-declared worktree base as of the
   * last chain load.
   *
   * Composed on read rather than stored, because its last field is not
   * construction state: the chain that declares the base is loaded per tick,
   * after this object would have been frozen. One composition, so every
   * worktree call site the dispatcher makes reads the same base
   * (`.claude/rules/engineering.md`, *Derived state is computed, never
   * restated beside its source*).
   */
  private get worktreeCtx(): WorktreeContext {
    return {
      repoRoot: this.opts.repoRoot,
      flumeDir: this.flumeDir,
      stateRootRel: this.stateRootRel,
      namespace: this.opts.namespace,
      log: this.log,
      ...(this.chainWorktreesBase !== undefined
        ? { declaredWorktreesBase: this.chainWorktreesBase }
        : {}),
    };
  }

  /**
   * What one agent attempt (`src/tickAttempt.ts`) reads, composed from what
   * this dispatcher already holds. Composed on read for the same reason
   * {@link worktreeCtx} is — it carries that context, whose last field the
   * per-tick chain load supplies — and never stored, so no attempt can run
   * against a snapshot taken before the tick resolved its chain.
   */
  private get attemptCtx(): AttemptContext {
    return {
      configDir: this.opts.configDir,
      configDirRel: computeStateRootRel(
        this.opts.repoRoot,
        this.opts.configDir,
      ),
      flumeDir: this.flumeDir,
      stateRootRel: this.stateRootRel,
      pendingPath: this.pendingPath,
      worktreeCtx: this.worktreeCtx,
      attempts: this.attempts,
      bounds: this.bounds,
      ...(this.opts.stopSignal !== undefined
        ? { stopSignal: this.opts.stopSignal }
        : {}),
      log: this.log,
    };
  }

  /** What `runGate` (`src/gateRun.ts`) needs from this dispatcher's afterMerge loops. */
  private get gateScope(): GateRunScope {
    return { worktreeCtx: this.worktreeCtx, log: this.log };
  }

  /**
   * What either leg of a tick reads off this dispatcher
   * ({@link TickLegContext}, `src/tickLeg.ts`): the roots the tick resolved,
   * the stores it records through, the two inner contexts above, and the
   * queue reads and batch arithmetic this class owns.
   *
   * Composed on read for the same reason {@link worktreeCtx} is — it carries
   * the two contexts whose last fields the per-tick chain load supplies — and
   * the four callables are bound to `this` rather than copied, so a leg
   * cannot answer "what is pickable" differently from the preview that shows
   * the same wave (`.claude/rules/engineering.md`, *Derived state is
   * computed, never restated beside its source*).
   */
  private get legCtx(): TickLegContext {
    return {
      repoRoot: this.opts.repoRoot,
      configDir: this.opts.configDir,
      flumeDir: this.flumeDir,
      stateRootRel: this.stateRootRel,
      pendingPath: this.pendingPath,
      attempts: this.attempts,
      attemptCtx: this.attemptCtx,
      worktreeCtx: this.worktreeCtx,
      gateScope: this.gateScope,
      log: this.log,
      ...(this.opts.ownTipClaimPid !== undefined
        ? { ownTipClaimPid: this.opts.ownTipClaimPid }
        : {}),
      ...(this.opts.quarantinedSlugs !== undefined
        ? { quarantinedSlugs: this.opts.quarantinedSlugs }
        : {}),
      ...(this.opts.commitMessage !== undefined
        ? { commitMessage: this.opts.commitMessage }
        : {}),
      readPending: () => this.readPending(),
      readPendingTolerant: () => this.readPendingTolerant(),
      isPendingRelocated: () => this.isPendingRelocated(),
      selection: (chain, pending, isForkResolved) =>
        this.selection(chain, pending, isForkResolved),
    };
  }

  /**
   * {@link selectBatch} bound to this dispatcher's own two knobs: the run's
   * live quarantine, and the parallelism ceiling the chain's own declaration
   * overrides. Bound here so the wave, the preview of that wave, and the
   * post-wave re-derivation all reach the one selection the same way
   * (`.claude/rules/engineering.md`, *Derived state is computed, never
   * restated beside its source*).
   */
  private selection(
    chain: Chain,
    pending: readonly PendingEntry[],
    isForkResolved: (slug: string) => boolean,
  ): BatchSelection {
    return selectBatch({
      chain,
      pending,
      isForkResolved,
      ...(this.opts.quarantinedSlugs !== undefined
        ? { quarantinedSlugs: this.opts.quarantinedSlugs }
        : {}),
      maxParallel: this.maxParallel,
    });
  }

  /**
   * The grace an agent tree this dispatcher aborts gets between its SIGTERM
   * and the SIGKILL that follows: what the chain {@link tick} resolved
   * declares, the engine's own {@link DEFAULT_KILL_GRACE_MS} where it declares
   * none — the number `terminateProcessTree` (`src/processTree.ts`) will
   * actually apply, rather than the absence a caller would have to fold for
   * itself. Before any chain resolves it is that default, which is what an
   * abort at that point would apply anyway.
   *
   * Reported rather than kept (`.claude/rules/engineering.md`, *A fact the
   * engine holds is reported, never rediscovered*): the caller that must name
   * this number is the `flume tick` signal handler, which writes it into the
   * line it prints at receipt (`src/cli.ts`), and reading it here instead of
   * resolving a chain of its own is what keeps a tick process to the single
   * chain-factory application {@link tick} makes.
   */
  get agentKillGraceMs(): number {
    return this.bounds.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  /** Run one phase × one tick. Returns hibernated outcome if nothing awake. */
  async tick(): Promise<TickOutcome> {
    const awake = this.baton.awake();

    // Disk is truth: this process resolves chain.ts exactly once, here. A
    // prior tick that rewrote chain.ts is governed by the new chain because
    // *this is a new process* (the supervisor spawned it) — not via any
    // in-process reload. The chain's optional `agent` export resolves with it.
    //
    // Engine resolution-failure fallback: there is no in-process
    // "last-good chain" to retain — recovery is structural, not in-memory. A
    // chainLoadGate-guarded broken chain.ts is reverted by its producing
    // tick, so the next tick's fresh process reads the restored file. An
    // *unguarded* broken chain.ts has nothing to run: log loudly and return a
    // no-work failed outcome. The `flume tick` process exits {@link
    // EX_MOUNT_DEAD}; the `flume loop` supervisor aborts the run on
    // first occurrence rather than proceeding — a mount-dead chain is exactly
    // as dead next tick as this one, so it does not burn the remaining
    // `--max` ticks re-hitting the same wall.
    let chainModule: ChainModule;
    try {
      chainModule = await this.chainLoader();
      // spec/worktrees.md "Placement": the declared base is evaluated here,
      // at the one point per process where a chain is in hand, and every
      // worktree this tick touches reads it off `worktreeCtx`. A declaration
      // that cannot be evaluated is a chain that cannot be run, so it lands
      // in the refusal below rather than surfacing as a worktree at a path
      // nothing sweeps.
      this.chainWorktreesBase = resolveWorktreesBaseDeclaration(
        chainModule.chain,
        this.paths,
      );
    } catch (err) {
      if (err instanceof CjsContextLoadError) {
        // A nameable usage fix, not a dead chain — `flume tick` exits 2
        // (usage), not EX_MOUNT_DEAD; distinct from `failed` below.
        this.log.error(`[flume] ${err.message}`);
        return {
          hibernated: false,
          usageError: true,
          awakeAfter: this.baton.awake(),
          summary: err.message,
        };
      }
      const msg = (err as Error).message;
      this.log.error(
        `[flume] chain resolution failed: ${msg}. This tick does no work. ` +
          `A chainLoadGate-guarded chain.ts is reverted by its producing ` +
          `tick; an unguarded broken chain.ts fails every tick until restored.`,
      );
      return {
        hibernated: false,
        failed: true,
        awakeAfter: this.baton.awake(),
        summary: `chain resolution failed: ${msg}; no work`,
      };
    }
    const chain = chainModule.chain;
    // The bounds every agent invocation this tick makes runs under, read at
    // the one point per process where a chain is in hand — the same per-tick
    // read as `entryExtension` and `pendingPath` below, and what
    // `agentKillGraceMs` reports to a caller that has no chain of its own.
    this.bounds = resolveAgentBounds(chain.supervisorPolicy, this.tickTimeoutMs);
    // Pending parses compose core + the chain's declared entry extension
    // remembered here because readPending runs downstream of the
    // one place the chain is loaded.
    this.entryExtension = chain.entryExtension;
    // spec/pending.md "The pending queue": Chain.pendingPath replaces the
    // constructor-fixed default — resolved once per tick, after chain load,
    // same idiom as entryExtension above.
    this.pendingPath = resolvePendingPath(this.flumeDir, chain.pendingPath);
    // Foundations governor: a chain.ts `forkResolver` export overrides the
    // constructor default per tick, mirroring the `agent` override.
    const forkResolver = chainModule.forkResolver ?? this.opts.forkResolver;

    const phase = chain.phases.find((p) => awake.includes(p.name));

    if (!phase) {
      if (awake.length > 0) {
        // Axis C: every awake flag names a phase the chain does not
        // declare. Not Axis B (nothing here is quiescent — the flags persist)
        // and not Axis A (no agent ran, nothing to retry). The flags stay on
        // disk so the human inspects, then `flume sleep <phase>` or fixes
        // the chain; clearing them would be a silent ack.
        const msg =
          `awake flags reference unknown phases: ${awake.join(", ")}; ` +
          `terminal misconfiguration (orphaned-awake), flags left on disk`;
        this.log.error(`[flume] ${msg}`);
        return {
          hibernated: false,
          terminal: { kind: "orphaned-awake", phases: awake },
          awakeAfter: awake,
          summary: msg,
        };
      }
      return {
        hibernated: true,
        awakeAfter: [],
        summary: "no phases awake; hibernating",
      };
    }

    // Per-phase delegation: the phase's own agent is the innermost
    // scope of the chain-level override chain.
    const agent = phase.agent ?? chainModule.agent ?? this.opts.agent;

    this.log.info(`[flume] tick → ${phase.name} (${phase.concurrency})`);

    let phaseOutcome: PhaseTickOutcome;
    try {
      phaseOutcome =
        phase.concurrency === "singleton"
          ? await runSingleton(this.legCtx, phase, agent, chain, forkResolver)
          : await runFanout(this.legCtx, phase, agent, chain, forkResolver);
    } catch (err) {
      if (!(err instanceof PendingParseFailure)) throw err;
      // Same failure class as an unresolved chain: no agent ran
      // (singleton/fanout's decide-read refused before invoking one) or a
      // wave's shipped work landed on trunk but the rewrite that would clear
      // it from pending.json refused rather than deriving `[]` from a parse
      // it never trusted — either way this tick does no more work, and a
      // fresh process next tick reads the same unparseable file until a
      // human fixes it. The exit code is unchanged either way (EX_MOUNT_DEAD,
      // `failed: true`) — `WaveLedgerParseFailure`'s carried `verdict` only
      // adds the record of what the wave shipped before the ledger rewrite
      // refused; it never softens the refusal itself.
      this.log.error(`[flume] ${err.message}`);
      return {
        hibernated: false,
        failed: true,
        awakeAfter: this.baton.awake(),
        summary: err.message,
        ...(err instanceof WaveLedgerParseFailure
          ? { verdict: err.verdict }
          : {}),
      };
    }
    const {
      result,
      noCommit,
      tipMoved,
      declined,
      bystanderCheckpointSha,
      provisionFailures,
      mergeFailures,
      gateFailures,
      tags,
      mergeOutcomes,
      invocations,
      clearedPriorAttempts,
    } = phaseOutcome;

    // Fold the already-computed no-commit classification into the
    // TickResult before handoff — a chain's `handoff` is the only place a
    // clean-exit wave can be distinguished from a genuine no-op.
    // `tipMoved` does NOT fold in here: `TickResult`
    // (`src/Phase.ts`) carries no field for it — the fact lives on
    // `TickOutcome`/`TickVerdict` alone, read by a fresh next tick, never by
    // this same tick's synchronous `handoff`.
    const resultForHandoff: TickResult = noCommit
      ? { ...result, noCommit }
      : result;

    // Sleep this phase by default; handoff re-wakes if needed.
    this.baton.sleep(phase.name);
    // spec/chain.md "What a hook receives": a throwing `handoff` is logged
    // and the tick's facts stand — every one of them is already computed
    // above, and the phase is already asleep, so the throw costs exactly the
    // wakes the hook never got to name and nothing else. Losing the verdict
    // and the merge bookkeeping to it would discard work that already landed
    // on trunk.
    let handoff: string[];
    try {
      handoff = phase.handoff(resultForHandoff);
    } catch (err) {
      const { message } = throwFacts(err);
      this.log.warn(
        `[flume] ${phase.name}: handoff threw: ${message}; no phase woken, this tick's facts stand`,
      );
      handoff = [];
    }
    const allowed = handoff.filter((n) => !chain.humanOnly.includes(n));
    for (const name of allowed) this.baton.wake(name);

    const summary = summarize(
      phase.name,
      result,
      allowed,
      noCommit,
      tipMoved,
      declined,
    );

    // The unified facts artifact — a pure value, built here so
    // `TickOutcome` carries everything the CLI's `tick` command needs to
    // persist it verbatim via `writeTickVerdict`. Building it is not itself
    // a disk write (the concern `writeTickVerdict`'s own doc names for
    // `Dispatcher.tick()` unit tests), so it costs the existing computed
    // fields (`summary` et al.) nothing extra.
    //
    // headSha/at (spec/loop.md "The tick verdict"): the trunk tip read here,
    // after this phase's own commits (if any) already landed — never
    // inferred from which paths the last commit touched, and left behind
    // even on a quiet no-commit tick.
    const verdict: TickVerdict = {
      phaseName: phase.name,
      tags: tags ?? [],
      committed: result.committed,
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(declined ? { declined } : {}),
      ...(bystanderCheckpointSha ? { bystanderCheckpointSha } : {}),
      gateResults: [...result.gateResults],
      shippedTags: [...result.shippedTags],
      mergeOutcomes: mergeOutcomes ?? [],
      invocations: invocations ?? [],
      ...(provisionFailures && provisionFailures.length > 0
        ? { provisionFailures }
        : {}),
      ...(mergeFailures && mergeFailures.length > 0 ? { mergeFailures } : {}),
      ...(gateFailures && gateFailures.length > 0 ? { gateFailures } : {}),
      ...(clearedPriorAttempts && clearedPriorAttempts.length > 0
        ? { clearedPriorAttempts }
        : {}),
      summary,
      headSha: await git.revParse(this.opts.repoRoot),
      at: new Date().toISOString(),
    };

    return {
      hibernated: false,
      phaseName: phase.name,
      result: resultForHandoff,
      verdict,
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(declined ? { declined } : {}),
      ...(provisionFailures && provisionFailures.length > 0
        ? { provisionFailures }
        : {}),
      ...(mergeFailures && mergeFailures.length > 0 ? { mergeFailures } : {}),
      ...(gateFailures && gateFailures.length > 0 ? { gateFailures } : {}),
      awakeAfter: this.baton.awake(),
      summary,
    };
  }

  // ---------- render: the resolution path, short of the invocation ----------

  /**
   * The prompt one tick would be handed, resolved without invoking anything —
   * `flume render`'s whole body (spec/cli.md, *Subcommand surface*).
   *
   * Every step below is the tick's own: `chainLoader`, `readPending`,
   * `pickableEntries`, `partitionByFileOverlap`, `attempts.readAll`,
   * `phasePromptPath`, `renderPrompt`. The verb this replaces re-derived
   * three of them beside the dispatcher and disagreed with it on all three
   * (operator ruling 2026-08-03), which is the failure this method exists to
   * make unrepresentable: there is one resolution, and a preview is it run
   * one call short of `invokeAgent`.
   *
   * Two deliberate departures from `tick()`, each because no tick is running:
   *
   *  - `cwd` is the primary checkout, not a provisioned worktree. Nothing is
   *    created, so nothing needs tearing down, and the inline-exec spans see
   *    the tree the operator is looking at.
   *  - No `<prior-attempt>` block. A render outside a tick has no attempt to
   *    carry, and it is never reconstructed; `TickContext.priorAttempts` is
   *    still the real on-disk map, because that one *is* a fact a hook reads.
   *
   * Nothing here writes: no baton flag, no `rendered-prompts/` record, and —
   * unlike `tick()`'s own hook seam — no persisted refusal, because a hook
   * that throws here refuses the verb instead of recording an attempt that
   * never happened. `shouldRun` is not consulted for the same reason: it
   * decides whether to invoke, and this path never does.
   */
  async render(opts: RenderRequest): Promise<RenderResolution> {
    const chainModule = await this.chainLoader();
    const chain = chainModule.chain;
    // The same two per-tick rebinds `tick()` takes off a freshly-loaded
    // chain, for the same two readers: `readPending`'s parse and its path.
    this.entryExtension = chain.entryExtension;
    this.pendingPath = resolvePendingPath(this.flumeDir, chain.pendingPath);

    const phase = chain.phases.find((p) => p.name === opts.phase);
    if (!phase) {
      throw new RenderUsageError(
        `unknown phase: ${opts.phase} — this chain declares ` +
          chain.phases.map((p) => p.name).join(", "),
      );
    }
    if (opts.entryTag !== undefined && phase.concurrency !== "fanout") {
      throw new RenderUsageError(
        `--entry ${opts.entryTag}: '${phase.name}' is a ${phase.concurrency} ` +
          `phase and picks no entry from the queue`,
      );
    }

    const pending = await this.readPending();
    const isForkResolved =
      (chainModule.forkResolver ?? this.opts.forkResolver)?.(
        this.opts.repoRoot,
      ) ?? (() => true);
    // The selection a fanout tick would make on this queue, under this
    // chain's declared knobs — taken from the one derivation `runFanout`
    // runs, never re-spelled here (.claude/rules/engineering.md, "A module
    // is one job").
    const { pickable, batches } = this.selection(chain, pending, isForkResolved);

    let entry: PendingEntry | undefined;
    if (phase.concurrency === "fanout") {
      if (opts.entryTag !== undefined) {
        // Looked up in the *queue*, not in `pickable`: previewing an entry a
        // tick would decline to carry is the point of naming one by hand, and
        // the verdict on it is reported below rather than spent as a refusal.
        entry = pending.find((e) => e.tag === opts.entryTag);
        if (!entry) {
          throw new RenderUsageError(
            `no entry tagged ${opts.entryTag} in the queue at HEAD ` +
              `(${pending.length} entr${pending.length === 1 ? "y" : "ies"})`,
          );
        }
      } else {
        if (pickable.length === 0) {
          throw new RenderUsageError(
            `${phase.name}: nothing pickable at HEAD, so no entry a tick ` +
              `would carry — name one with --entry <tag>`,
          );
        }
        // The first member of the batch `runFanout` would build is the entry
        // the next wave carries first.
        entry = batches[0]![0]!;
      }
    }

    const priorAttempts = await this.attempts.readAll();
    // Each concurrency's own context, field for field — a singleton reads the
    // whole queue and carries no assignment, a fanout entry carries its
    // assignment and no queue. A preview that widened either would show the
    // chain a `promptArgs` input the tick never gets.
    const ctx: TickContext = {
      cwd: this.opts.repoRoot,
      flumeDir: this.flumeDir,
      stateRootRel: this.stateRootRel,
      pickable,
      priorAttempts,
      ...(entry !== undefined ? { assignedEntry: entry } : { pending }),
    };

    let args: Record<string, string>;
    try {
      args = phase.promptArgs?.(ctx) ?? {};
    } catch (err) {
      // Same class the tick calls `render-refused`: the prompt never
      // resolved, so there is nothing to show. Loud, never a partial render.
      throw new RenderUnresolvedError(
        `${phase.name}: promptArgs threw: ${throwFacts(err).message}`,
      );
    }

    const prompt = await renderPrompt({
      phase,
      flumeDir: this.flumeDir,
      promptFile: phasePromptPath(this.opts.configDir, phase.promptPath),
      cwd: this.opts.repoRoot,
      args,
      ...(entry !== undefined ? { assignedEntry: entry } : {}),
    });

    return {
      phaseName: phase.name,
      ...(entry !== undefined ? { entry } : {}),
      pickable,
      prompt,
    };
  }

  // ---------- the queue's own reads, and the worktree sweep ----------

  /**
   * Startup sweep over this dispatcher's own worktree base
   * ({@link sweepStaleWorktrees}, `src/worktrees.ts` — what it removes, and
   * what it deliberately leaves standing, is documented there). Stays a
   * method because `flume loop` and `flume job run` reach it through the
   * Dispatcher they already hold (`src/cli.ts`), after the tip claim is
   * acquired and before the first tick.
   */
  async sweepStaleWorktrees(): Promise<void> {
    // The sweep runs before the first tick, so nothing has loaded a chain
    // into this process yet — and the base it sweeps has to be the base the
    // ticks create under, or it reads an empty directory and then fails
    // every `git branch -D` against worktrees still standing elsewhere
    // (spec/worktrees.md, *Placement*: the base is resolved once). Hence the
    // load here rather than a value the caller passes: the declaration is
    // the engine's to evaluate, at one spelling shared with `tick`.
    //
    // Declared degradation (`.claude/rules/engineering.md`, *Loud or
    // nothing*): a chain that will not load — or whose `worktreesBase`
    // refuses — leaves the engine's own base swept, silently. The refusal
    // that bounds it is `tick`'s: the very next thing this run does is load
    // the same chain through the same spelling, and it names the failure and
    // does no work. A chain that cannot run creates no worktree under any
    // base, so there is nothing at the declared one for this sweep to have
    // missed — and a second copy of that message here would break the one
    // thing an operator reads this sweep's output for, which is silence when
    // there was no residue.
    try {
      this.chainWorktreesBase = resolveWorktreesBaseDeclaration(
        (await this.chainLoader()).chain,
        this.paths,
      );
    } catch {
      // bounded above
    }
    await sweepStaleWorktrees(this.worktreeCtx);
  }

  /**
   * Strict reader: throws {@link PendingParseFailure} on a parse error rather
   * than degrading to `[]`. Used at every read this dispatcher acts on — the
   * singleton/fanout decide-reads and `commitPendingUpdate`'s rewrite read
   * (.claude/rules/engineering.md "Loud or nothing": a decision or a rewrite
   * must never derive from an input that failed to resolve).
   * `readPendingTolerant` below is the one declared exception, for the two
   * report-only reads.
   *
   * spec/pending.md "Dispatch reads come from the tip, not the tree":
   * resolves the committed `HEAD` tip (`git.readFileAtRef`), never the
   * working tree — a mid-wave merge, an engine revert, or an operator's
   * staged edit can each leave the tree ahead of or behind the branch, and a
   * dispatch decision must never act on state no commit owns. An out-of-tree
   * `pendingPath` (a relocated state root) has no tip to read — invisible to
   * git by construction (`commitPendingUpdate`, `src/waveTick.ts`), so it
   * stays the one disk-reading case here, alongside `readPendingTolerant`.
   */
  private async readPending(): Promise<PendingEntry[]> {
    if (this.isPendingRelocated()) {
      // win32 MAX_PATH: a relocated pendingPath sits under an arbitrary
      // state root. namespacedJoin (src/paths.ts) is the shared idiom.
      // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts)
      // throws on any other stat failure rather than reporting absence, so a
      // ledger that is present but unreachable — a symlink loop, a
      // permission-denied parent on the state root — refuses here instead of
      // dispatching this tick over an empty queue.
      if (!existsLoud(namespacedJoin(this.pendingPath))) return [];
      const raw = await readFile(namespacedJoin(this.pendingPath), "utf8");
      const r = parsePending(raw, this.entryExtension);
      if (!r.ok) throw new PendingParseFailure(r.errors);
      return r.entries;
    }
    const rel = relative(this.opts.repoRoot, this.pendingPath);
    const raw = await git.readFileAtRef(this.opts.repoRoot, "HEAD", rel);
    if (raw === null) return [];
    const r = parsePending(raw, this.entryExtension);
    if (!r.ok) throw new PendingParseFailure(r.errors);
    return r.entries;
  }

  /**
   * Whether `pendingPath` sits outside `repoRoot` — an out-of-tree state
   * root's ledger, invisible to git by construction. Shared by
   * `readPending`'s tip-vs-disk choice and `commitPendingUpdate`'s
   * commit-vs-disk-only choice (`src/waveTick.ts`): one relocation check,
   * not two independently re-derived ones. Delegates to `computeStateRootRel`'s own escape check
   * rather than re-deriving it (`.claude/rules/engineering.md` "The fix
   * lands at the mechanism").
   */
  private isPendingRelocated(): boolean {
    return (
      computeStateRootRel(this.opts.repoRoot, this.pendingPath) === undefined
    );
  }

  /**
   * Tolerant twin of `readPending()`, kept only for `TickResult.pendingAfter`
   * — an informational re-read taken after this tick's own strict decide- or
   * rewrite-read already ran (and, for the fanout wave, after any shipped
   * work already landed on trunk). A parse failure here means something
   * outside this tick corrupted the file in the gap between that strict read
   * and now; degrading to `[]` is bounded because `pendingAfter` — and the
   * `TickResult.pickableAfter` derived from it — feeds only the handoff's
   * advisory read of what is pickable next, never a rewrite or a work
   * decision (.claude/rules/engineering.md "Loud or nothing": the
   * degraded-but-proceeding path, declared and cited at its two call sites).
   *
   * Every way this read can fail degrades the same declared way — announced,
   * then `[]`. It cannot refuse the way `readPending` does: it runs after the
   * tick's work has already landed, so a throw here would lose the
   * `TickResult` that describes it. The tolerance is in this reader, never in
   * the probe: `existsLoud` (src/fsProbe.ts) still splits absent from
   * unreachable, and the catches below turn that refusal — and any failure
   * of the read past it — into the warn a silent `existsSync` `false` would
   * have skipped.
   */
  private async readPendingTolerant(): Promise<PendingEntry[]> {
    // win32 MAX_PATH: namespacedJoin (src/paths.ts) is the shared idiom.
    try {
      if (!existsLoud(namespacedJoin(this.pendingPath))) return [];
    } catch (err) {
      // Present but unreachable — a symlink loop, a permission-denied
      // parent. `readPending`'s strict twin refuses on exactly this; here it
      // is announced and treated as empty, so a drained-looking
      // `pendingAfter` is never the first anyone hears of it.
      this.log.warn(
        `[flume] pending.json could not be stat'd (${
          (err as Error).message
        }); treating as empty`,
      );
      return [];
    }
    let raw: string;
    try {
      raw = await readFile(namespacedJoin(this.pendingPath), "utf8");
    } catch (err) {
      // Stattable but unreadable — a directory at the path, a mode denying
      // the file itself, a delete racing the probe above. Same declared
      // degrade as the stat and parse branches: announced, then `[]`, never
      // a throw that would take this tick's `TickResult` with it.
      this.log.warn(
        `[flume] pending.json could not be read (${
          (err as Error).message
        }); treating as empty`,
      );
      return [];
    }
    const r = parsePending(raw, this.entryExtension);
    if (!r.ok) {
      this.log.warn(
        `[flume] pending.json failed to parse (${r.errors.length} errors); treating as empty`,
      );
      return [];
    }
    return r.entries;
  }
}

// ---------- module-private utilities ----------

function summarize(
  phaseName: string,
  result: TickResult,
  awaking: string[],
  noCommit?: NoCommitMode,
  tipMoved?: boolean,
  declined?: boolean,
): string {
  const parts: string[] = [phaseName];
  if (result.committed) {
    if (result.shippedTags.length > 0) {
      parts.push(`shipped ${result.shippedTags.join(", ")}`);
    } else if (result.commitSha) {
      parts.push(`committed ${result.commitSha.slice(0, 8)}`);
    }
    // A wave can ship *and* hit the tip-verify backstop (some entries landed
    // before the ref moved; the rest, or the trailing ledger commit,
    // refused) or a decline (some entries declined while their siblings ran).
    if (tipMoved) parts.push("(tip-moved for part of this tick)");
    if (declined) parts.push("(declined for part of this tick)");
  } else {
    // The no-commit mode in the one-liner is the logger record that lets a
    // clean-exit loop be told from a platform-preempt run without
    // reading session logs. `tip-moved` and `declined` are reported the same
    // way even though neither is
    // ever a `NoCommitMode` — the one-liner is a rendering, not the typed
    // fact itself.
    parts.push(
      tipMoved
        ? "no commit (tip-moved)"
        : declined
          ? "no commit (declined)"
          : noCommit
            ? `no commit (${noCommit})`
            : "no commit",
    );
  }
  if (awaking.length > 0) parts.push(`→ ${awaking.join(",")}`);
  else parts.push(`→ hibernate`);
  return parts.join(" ");
}
