/**
 * Dispatcher — the runtime. Reads baton, picks the awake phase, dispatches
 * the work to that phase's concurrency leg, and reports the verdict the leg
 * hands back.
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
 * What a tick reads and writes, each in the file its name is: the pending
 * ledger's own reads and the wave's rewrite of it (`src/pendingLedger.ts`),
 * which entries of the queue it may pick and the batch a wave carries off it
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
 * chain load, the dispatch to a leg, the verdict each leg reports in, and the
 * preview (`render`) of the tick that would run.
 */

import type { Agent } from "./Agent.js";
import { Baton } from "./Baton.js";
import {
  CjsContextLoadError,
  diskChainLoader,
  type LoadedChain,
} from "./chainLoad.js";
import {
  assertPositiveCount,
  WAVE_WIDTH_FLOOR_REASON,
} from "./counted.js";
import { EntryClaimStore } from "./entryClaims.js";
import type { FlumePaths } from "./flumeApi.js";
import type { GateRunScope } from "./gateRun.js";
import { consoleLogger, type Logger } from "./log.js";
import {
  computeStateRootRel,
  defaultStateRoot,
  resolvePendingDir,
} from "./paths.js";
import {
  readPendingForDecision,
  type PendingLedgerContext,
} from "./pendingLedger.js";
import { DEFAULT_KILL_GRACE_MS } from "./processTree.js";
import { PriorAttemptStore } from "./priorAttempts.js";
import { PendingParseFailure, descendantsOf } from "./PendingSchema.js";
import type { EntryExtension, PendingEntry } from "./PendingSchema.js";
import type { Chain, TickContext, TickResult } from "./Phase.js";
import {
  PromptTemplateUnreadableError,
  readPhaseTemplate,
  renderPrompt,
} from "./Prompt.js";
import type { NoCommitMode } from "./Prompt.js";
import {
  type BatchSelection,
  type SelectionRequest,
  selectBatch,
} from "./selection.js";
import { runSingleton } from "./singletonTick.js";
import type { AgentBounds, AttemptContext } from "./tickAttempt.js";
import type { PhaseTickOutcome, TickLegContext } from "./tickLeg.js";
import {
  buildTickVerdict,
  clearInvocationRows,
  readInvocationRows,
  type DeclinedWake,
  type GateFailure,
  type MergeFailure,
  type PlatformFailure,
  type ProvisionFailure,
  type RenderFailure,
  type ShipFailure,
  type TickVerdict,
  type UnclassedWall,
  type WakeDeclineReason,
} from "./tickVerdict.js";
import * as git from "./git.js";
import {
  WaveCarriedThrow,
  WaveLedgerRefusal,
  type LedgerRefusalClass,
} from "./waveMerge.js";
import { runFanout } from "./waveTick.js";
import {
  sweepStaleWorktrees,
  type WorktreeContext,
} from "./worktrees.js";
import { throwFacts, thrownMessage } from "./thrown.js";

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
 * The fanout width a dispatcher binds when the embedder passed none and the
 * chain declares none. One number, read by the binding and by the refusal
 * that names what omitting the option falls back to.
 */
const DEFAULT_MAX_PARALLEL = 4;

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
   * (`plan/pending/`), worktrees (`worktrees/`), and prior-attempt records
   * (`prior-attempts/`) live. Defaults to `<repoRoot>/.flume` — the historical
   * fixed location. Relocate it to run a fully self-contained, ephemeral
   * harness whose entire footprint can be removed in one `rm` (the
   * attach-work-detach posture: state never bleeds into `<repoRoot>/.flume`).
   * Independent of `configDir`; set both to the same dir to co-locate config
   * and state.
   */
  flumeDir?: string;
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
  chainLoader?: () => Promise<LoadedChain>;
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
   * Max parallel ticks per fanout batch. A positive integer, refused at
   * construction below one or fractional — the width is the only thing
   * standing between a ready queue and a wave that opens no slot, and the
   * chain's own half of it is refused at the load the same way
   * (`src/chainLoad.ts`). Default 4. Overridable per chain via
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
   * settles once that tree is gone — `AgentInvocation.signal`
   * (`src/Agent.ts`). The `flume tick` command supplies its own controller's
   * signal and awaits `tick()` before it releases the tip claim and exits,
   * so a signalled bare tick leaves no writer inside the state root the
   * claim protected (spec/loop.md, "The loop lock and the tip claim").
   * Default: unset — a
   * dispatcher nobody can stop, which is every embedder that never wired one.
   */
  stopSignal?: AbortSignal;
  /**
   * `entryDeclaredKey` (`src/entryKey.ts`) values (`slug@hash`) excluded from
   * this tick's fanout pick even though the queue still lists them as
   * pickable — the queue itself is untouched. The `flume loop`
   * supervisor populates this (via the `tick` command's
   * `FLUME_QUARANTINED_SLUGS` env var, whose name predates the key and
   * stands) from entries whose provision, render, merge, gate or ship stage
   * failed earlier in the run — never a platform-stage one, which is blamed on
   * no entry and feeds the run's backstop alone; the exclusion is run-scoped only — a fresh run/process always
   * starts with nothing quarantined. Because the key covers the entry's
   * bytes, an entry re-scoped on trunk no longer matches the held key and
   * is pickable again without a relaunch. Default: nothing quarantined.
   */
  quarantinedSlugs?: ReadonlySet<string>;
  /**
   * spec/loop.md "Graceful stop — the stop flag": whether this run honors the
   * operator's `<flumeDir>/stop` flag *inside* a tick — a fanout wave reads it
   * at each freed slot and pulls nothing more, while everything in flight
   * finishes, merges and is recorded. The flag stops a supervisor's iteration
   * and a supervised wave's refill; a bare `flume tick` is the operator's own
   * explicit action and ignores it, which is why this is told rather than
   * inferred (.claude/rules/engine-boundary.md, "Told, not inferred"): the
   * CLI already knows which of the two it is — it reads `FLUME_TIP_CLAIM_HELD`
   * to decide whether to acquire a claim of its own — and states it here. A
   * wave whose run never refills past its first fill never reads the flag
   * either way. Default: unset — a run nobody told, which is every embedder
   * that never wired a supervisor.
   */
  supervisedRun?: boolean;
  /**
   * spec/loop.md "The loop lock and the tip claim": the pid of the tip
   * claim *this run* operates under — its own (a bare `flume tick`, which
   * acquires directly in-process, so this equals `process.pid`) or its
   * supervisor's (a loop-spawned child, told via `FLUME_TIP_CLAIM_HELD`).
   * `liveForeignClaimPid` (either leg's tip-verify check, consulted before
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
   * footprints were recorded, and commits the queue with whatever string
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
 * What one {@link Dispatcher.tick} run was asked for. Empty is the bare
 * tick: the baton decides which phase runs.
 */
export interface TickRequest {
  /**
   * Run this phase, awake or not — `flume tick --phase <name>`, and how the
   * supervisor tells a child what it is for (spec/loop.md, *Baton — presence
   * wakes, absence hibernates*). The baton is not consulted for selection:
   * neither a flag's absence nor a flag naming some other phase changes what
   * runs. A name the chain does not declare refuses before any work, on
   * {@link TickOutcome.undeclaredPhase}.
   *
   * Absent: the first phase in declared order whose name is awake.
   */
  phase?: string;
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
   * failure class. The `flume tick` process exits `EX_MOUNT_DEAD`
   * (`src/exitCodes.ts`); the `flume loop` supervisor re-reads the mount at
   * the tip and aborts the run only while a wall still stands, a cause
   * repaired in the gap leaving the tick an error and the run going on
   * (`spec/loop.md`, *Exit codes — the run never lies to CI*). Distinct from
   * `hibernated` (clean stop) and from a no-commit tick (the agent ran but
   * produced or kept no commit).
   */
  failed?: boolean;
  /**
   * On a `failed` tick whose failure was the pending ledger refusing, which
   * way it refused ({@link LedgerRefusalClass}) — stated by the site that
   * refused, never re-read here off the message. Absent on every other
   * `failed` tick: chain resolution, an invalid declaration, a missing state
   * root, and a wave torn down by a throw that refused no ledger at all — an
   * agent that exploded, a hook that threw, a render that did not resolve.
   * Those last carry {@link verdict} instead, which is what narrows them.
   *
   * The engine reader is `tickExitCode` (`src/cliVerdict.ts`), which exits 1
   * over `"commit-refusal"` instead of `EX_MOUNT_DEAD`
   * (`src/exitCodes.ts`) — the chain mounted, so the run is not dead and
   * `flume loop` proceeds. A fact, never a verdict: what a chain does with
   * it is the chain's
   * (`.claude/rules/engine-boundary.md`, *Routing rule (plan, build, and
   * interactive sessions)*).
   */
  ledgerRefusal?: LedgerRefusalClass;
  /**
   * Set when the tick was asked for a phase by name ({@link TickRequest})
   * and the chain that loaded declares no such phase: the request named a
   * world this chain is not. Rides `failed` and narrows it the way
   * {@link ledgerRefusal} does — `tickExitCode` (`src/cliVerdict.ts`) exits 2
   * rather than `EX_MOUNT_DEAD`, because the chain mounted fine and the only
   * thing wrong is the name it was handed: argv the surface cannot honor as
   * typed, which is the code `wake`, `sleep` and `render` already answer an
   * undeclared phase name with.
   *
   * Both halves are facts, never a verdict: what was asked for, and what the
   * chain declares instead — so a caller names the alternatives without
   * re-resolving a chain of its own (`.claude/rules/engineering.md`, *A fact
   * the engine holds is reported, never rediscovered*). No agent ran, no
   * baton flag moved, and a bare tick's selection is untouched — this arm is
   * reachable only through an explicit name.
   */
  undeclaredPhase?: { requested: string; declared: readonly string[] };
  /**
   * Set when a bare tick found flags standing and a hold over every one of
   * them: the phases it declined to pick, in baton order (spec/loop.md,
   * *Baton — presence wakes, absence hibernates*). Neither a failure nor
   * hibernation — the flags stand, the holds are the operator's, no agent
   * ran and no flag moved, so the process exits 0 the way a hibernated tick
   * does.
   *
   * Reachable only through a bare tick: `flume tick --phase <name>` runs a
   * held phase as the operator's own explicit action, and never reaches this
   * arm. Reported rather than left to a caller comparing `awakeAfter`
   * against a hold set of its own (`.claude/rules/engineering.md`, *A fact
   * the engine holds is reported, never rediscovered*); what to do about it
   * stays the caller's.
   */
  heldPhases?: readonly string[];
  /**
   * Set when the phase this tick selected declares a prompt file that could
   * not be read — nothing at the address, a directory, a denial. Rides
   * `failed` and narrows it the way {@link undeclaredPhase} does: the chain
   * mounted and the phase is declared, so what is dead is one input on disk,
   * and `tickExitCode` (`src/cliVerdict.ts`) classifies it mount-dead with a
   * cause that names the path rather than leaving it to the arm that has no
   * shape of its own.
   *
   * Both paths are facts, never a verdict: the address the chain declared and
   * what it resolved to, so a chain names the file it must restore without
   * re-resolving the join the engine already made (`.claude/rules/engineering.md`,
   * *A fact the engine holds is reported, never rediscovered*). The load runs
   * beside the chain load, so no agent ran, no worktree was provisioned, and
   * the selected phase is left awake — this tick owes the work it did not do.
   */
  promptUnreadable?: { promptPath: string; resolvedPath: string };
  /**
   * Set when chain resolution failed with the CJS-context
   * signature — a usage error (the host repo's package.json is missing
   * `"type": "module"`) with a concrete, nameable fix, not a mount-dead
   * chain nothing can retry. `flume tick` exits 2 (usage), never
   * `EX_MOUNT_DEAD` (`src/exitCodes.ts`); sibling to `failed`, mutually
   * exclusive with it — this is the one chain-resolution failure that isn't
   * `failed`.
   */
  usageError?: boolean;
  /**
   * For a no-commit tick: which of the
   * four causally-distinct modes produced no usable commit —
   *  - `gate-revert`      a commit was made then a gate reverted it,
   *  - `clean-exit`       the agent exited cleanly with no usable commit —
   *                       none at all, or a span whose diff against its
   *                       base is empty — and what that meant is the
   *                       chain's reading of the recorded final message,
   *                       never an engine label,
   *  - `platform-preempt` the agent process failed for non-work reasons
   *                       (rate-limit, auth, timeout, dispatcher-killed) —
   *                       NOT a defect in the work,
   *  - `render-refused`   the prompt itself never resolved — an inline-exec
   *                       span that would not resolve, a `{{KEY}}` no arg
   *                       filled, a `promptArgs` hook that threw, or a
   *                       `shouldRun` hook that threw — so the agent was
   *                       never invoked at all.
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
   * exits `EX_TERMINAL_MISCONFIG` (`src/exitCodes.ts`) when this is set.
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
   * See {@link TickVerdict.renderFailures}.
   * Present only when the tick hit at least one; absent on a tick whose every
   * render resolved.
   */
  renderFailures?: RenderFailure[];
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
   * See {@link TickVerdict.platformFailures}.
   * Present only when the tick hit at least one; absent on a tick whose every
   * agent exited on its own account.
   */
  platformFailures?: PlatformFailure[];
  /**
   * See {@link TickVerdict.shipFailures}.
   * Present only when the tick hit at least one; absent on a tick whose every
   * `shipped` consult answered with a list its span could ship.
   */
  shipFailures?: ShipFailure[];
  /**
   * See {@link TickVerdict.unclassedWalls}. Present only on the one `failed`
   * path that carries a walled wave's verdict — and only when that wave held
   * more than one wall — so a supervisor reading the handoff sees the wall
   * `summary` and `ledgerRefusal` could not name without opening the verdict
   * file beside them.
   */
  unclassedWalls?: UnclassedWall[];
  /**
   * This tick's unified facts artifact, present iff a phase
   * actually ran (same condition as `result`) — absent on `hibernated`,
   * `usageError`, or `terminal`. One exception on `failed`: a fanout wave
   * torn down after its picks landed — the `commitPendingUpdate` that refused
   * for any reason, a mid-wave queue re-read, and equally an agent that
   * exploded, a hook that threw or a render that did not resolve
   * (`WaveCarriedThrow`, `src/waveMerge.ts`) — still ran a phase, shipped
   * tags onto trunk and spent agents before it, so `failed: true` carries
   * `verdict` too in that one case — every other `failed` path (chain
   * resolution, a decide-read parse failure with no agent run) carries none.
   * The CLI's
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
 * Every {@link TickOutcome} field that mirrors a {@link TickVerdict} record
 * bucket — derived from the two shapes rather than listed: a name both declare,
 * holding rows. {@link MIRRORED_BUCKETS} below is that set at runtime, and a
 * bucket added to both shapes without a key there reds the typecheck, so the
 * projection cannot fall behind the shapes it reads.
 */
type MirroredBucket = {
  [K in keyof TickOutcome]-?: K extends keyof TickVerdict
    ? NonNullable<TickOutcome[K]> extends readonly unknown[]
      ? K
      : never
    : never;
}[keyof TickOutcome];

/** The buckets above, as keys a projection can walk. */
const MIRRORED_BUCKETS: { readonly [K in MirroredBucket]: true } = {
  provisionFailures: true,
  renderFailures: true,
  mergeFailures: true,
  gateFailures: true,
  platformFailures: true,
  shipFailures: true,
  unclassedWalls: true,
};

/**
 * A verdict's record buckets, projected onto the fields {@link TickOutcome}
 * declares for them. One projection, called by both of
 * {@link Dispatcher.tick}'s return arms — the walled arm over the verdict the
 * torn-down wave carried out, the completing arm over the verdict it just
 * built — so a bucket reaches both arms or neither, instead of being spelled
 * per arm and mirrored on one (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*).
 *
 * Emptiness is the verdict's own test: a key present here has rows, which is
 * what each mirrored field's doc above promises ("Present only when the tick
 * hit at least one").
 */
function mirrorFailureBuckets(
  verdict: TickVerdict,
): Pick<TickOutcome, MirroredBucket> {
  const mirrored: Pick<TickOutcome, MirroredBucket> = {};
  for (const bucket of Object.keys(MIRRORED_BUCKETS) as MirroredBucket[]) {
    const rows = verdict[bucket];
    if (rows !== undefined && rows.length > 0)
      Object.assign(mirrored, { [bucket]: rows });
  }
  return mirrored;
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
 * (`.claude/rules/engine-boundary.md`, *Routing rule (plan, build, and
 * interactive sessions)*): the caller decides what to print and what to
 * exit with.
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
 * way; here there is simply no invocation to skip. A stage of the render
 * itself refusing is the same class and keeps its own richer types under
 * `RenderRefusal` (`src/Prompt.ts`) — `InlineExecRenderError`, naming every
 * failing span, and `MissingPlaceholderRenderError`, naming every key no arg
 * filled.
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
  /**
   * The repository's per-entry claims (`src/entryClaims.ts`) — one store, so
   * the preview, both legs and every re-derivation read the same directory
   * through the same liveness probe.
   */
  private readonly claims: EntryClaimStore;
  private readonly log: Logger;
  private readonly maxParallel: number;
  private readonly tickTimeoutMs: number | undefined;
  private readonly flumeDir: string;
  /**
   * The state root's path relative to the repo root in git's alphabet
   * (`computeStateRootRel`, `src/paths.ts`), `undefined` when that root is
   * relocated outside the repo. Every gate reads it as
   * `GateContext.stateRootRel`, and the teardown harvest as the offset a
   * worktree mirrors the state root at (`harvestFriction`, `src/friction.ts`).
   *
   * Stored rather than composed on read — the opposite call from
   * {@link worktreeCtx} and {@link attemptCtx}, which carry it — because both
   * roots it folds are construction arguments: nothing this dispatcher does
   * later can change the answer, so there is no snapshot to go stale.
   */
  private readonly stateRootRel: string | undefined;
  /** The roots this dispatcher resolved, as the chain factory receives them. */
  private readonly paths: FlumePaths;
  /**
   * The worktree base the chain this dispatcher last loaded declared, as the
   * load reported it (`LoadedChain.worktreesBase`) — `undefined` until one is
   * loaded, and whenever the chain declares none. Taken from the load rather
   * than computed here, which is what "evaluated at load" buys
   * (spec/worktrees.md, *Placement — the worktree base*): the declaration is
   * chain code, and a dispatcher that ran it again would be a second
   * evaluation of it per process.
   */
  private chainWorktreesBase: string | undefined;
  private pendingDir: string;
  private readonly chainLoader: () => Promise<LoadedChain>;
  /** Set when tick() loads the chain; composes pending parses. */
  private entryExtension: EntryExtension | undefined;
  /**
   * Set when tick() loads the chain, beside {@link entryExtension}: the depth
   * cap every pending parse this tick makes reads (`Chain.maxEntryDepth`,
   * `src/Phase.ts`). `undefined` until a chain is loaded, and whenever the
   * chain declares none — which the parse reads as its own default.
   */
  private maxEntryDepth: number | undefined;
  /**
   * What the chain this dispatcher last loaded declared about its agent
   * invocations, reported through {@link agentKillGraceMs}. Initialized to
   * the constructor's own fallbacks, which is what a dispatcher that has
   * resolved no chain yet would apply.
   */
  private bounds: AgentBounds;

  constructor(opts: DispatcherOptions) {
    // Before anything this dispatcher builds: a width below one is a run that
    // cannot happen, and the wave is the wrong place to learn it — the slot
    // fill would read a ready queue, take none of it, and report the untouched
    // queue as a quiet no-op. The chain's half of this width refuses at the
    // load through the same predicate (`src/chainLoad.ts`).
    assertPositiveCount("dispatcher constructed with", {
      field: "maxParallel",
      value: opts.maxParallel,
      why: WAVE_WIDTH_FLOOR_REASON,
      omitted: `${DEFAULT_MAX_PARALLEL} slots per wave`,
    });
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
    this.claims = new EntryClaimStore(opts.repoRoot);
    this.maxParallel = opts.maxParallel ?? DEFAULT_MAX_PARALLEL;
    this.tickTimeoutMs = opts.tickTimeoutMs;
    this.bounds = resolveAgentBounds(undefined, this.tickTimeoutMs);
    this.pendingDir = resolvePendingDir(this.flumeDir);
    this.chainLoader = opts.chainLoader ?? diskChainLoader(this.paths);
  }

  /**
   * This dispatcher's view of itself for `src/worktrees.ts` — the repo root,
   * state root, that root's relative path, the logger the worktree lifecycle
   * reads, and the chain-declared worktree base as of the last chain load.
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
   *
   * `promptTemplate` is a parameter rather than a field for the same reason:
   * the tick loads it once beside its chain, and passing it through the
   * composition is what makes an attempt that renders from anything else
   * unrepresentable.
   */
  private attemptCtxFor(promptTemplate: string): AttemptContext {
    return {
      configDir: this.opts.configDir,
      promptTemplate,
      configDirRel: computeStateRootRel(
        this.opts.repoRoot,
        this.opts.configDir,
      ),
      flumeDir: this.flumeDir,
      stateRootRel: this.stateRootRel,
      pendingDir: this.pendingDir,
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
   * What the pending ledger's reads and its one rewrite
   * (`src/pendingLedger.ts`) take from this dispatcher: the repo root, the
   * state root a disk read of the queue descends from, the ledger path and
   * entry extension this tick's chain resolved, the logger, and the two knobs
   * the rewrite's commit takes.
   *
   * Composed on read for the same reason {@link worktreeCtx} is — two of its
   * fields are rebound by the per-tick chain load, after this object would
   * have been frozen — so neither the preview's read nor a leg's can run
   * against a ledger path resolved for a different chain.
   */
  private get ledgerCtx(): PendingLedgerContext {
    return {
      repoRoot: this.opts.repoRoot,
      flumeDir: this.flumeDir,
      pendingDir: this.pendingDir,
      entryExtension: this.entryExtension,
      log: this.log,
      ...(this.maxEntryDepth !== undefined
        ? { maxEntryDepth: this.maxEntryDepth }
        : {}),
      ...(this.opts.ownTipClaimPid !== undefined
        ? { ownTipClaimPid: this.opts.ownTipClaimPid }
        : {}),
      ...(this.opts.commitMessage !== undefined
        ? { commitMessage: this.opts.commitMessage }
        : {}),
    };
  }

  /**
   * What either leg of a tick reads off this dispatcher
   * ({@link TickLegContext}, `src/tickLeg.ts`): the roots the tick resolved,
   * the stores it records through, the two inner contexts above, the ledger
   * context a leg hands to the queue's own readers, and the batch arithmetic
   * this class owns.
   *
   * Composed on read for the same reason {@link worktreeCtx} is — it carries
   * the three contexts whose last fields the per-tick chain load supplies,
   * and the prompt template the tick loaded with them —
   * and `selection` is bound to `this` rather than copied, so a leg cannot
   * answer "what is pickable" differently from the preview that shows the
   * same wave (`.claude/rules/engineering.md`, *Derived state is computed,
   * never restated beside its source*).
   */
  private legCtxFor(promptTemplate: string): TickLegContext {
    return {
      ...this.ledgerCtx,
      configDir: this.opts.configDir,
      stateRootRel: this.stateRootRel,
      attempts: this.attempts,
      claims: this.claims,
      attemptCtx: this.attemptCtxFor(promptTemplate),
      worktreeCtx: this.worktreeCtx,
      gateScope: this.gateScope,
      ...(this.opts.quarantinedSlugs !== undefined
        ? { quarantinedSlugs: this.opts.quarantinedSlugs }
        : {}),
      supervisedRun: this.opts.supervisedRun === true,
      selection: (opts) => this.selection(opts),
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
  private selection(opts: SelectionRequest): BatchSelection {
    return selectBatch({
      chain: opts.chain,
      pending: opts.queue.pending,
      filingTimes: opts.queue.filingTimes,
      isForkResolved: opts.isForkResolved,
      claimedSlugs: opts.claimedSlugs,
      ...(this.opts.quarantinedSlugs !== undefined
        ? { quarantinedSlugs: this.opts.quarantinedSlugs }
        : {}),
      refusalFacts: opts.refusalFacts,
      maxParallel: this.maxParallel,
      inFlight: opts.inFlight,
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
   * line it prints at receipt (`src/cliTick.ts`), and reading it here instead of
   * resolving a chain of its own is what keeps a tick process to the single
   * chain-factory application {@link tick} makes.
   */
  get agentKillGraceMs(): number {
    return this.bounds.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  /**
   * Run one phase × one tick. Bare, the baton picks the phase and a tick
   * over an empty baton returns the hibernated outcome; {@link
   * TickRequest.phase} names one instead, which runs awake or not and never
   * hibernates.
   */
  async tick(request: TickRequest = {}): Promise<TickOutcome> {
    const awake = this.baton.awake();
    // What each standing flag carries at this tick's start, read here rather
    // than after the chain resolves: a wake landing while `chainLoader()`
    // imports chain.ts is as much a mid-tick wake as one landing during the
    // agent invocation, and a token read after the load would already have
    // swallowed it. The sleep below hands the phase's own value back
    // (`Baton.sleepIfUnchanged`), so a sibling's wake anywhere after this line
    // survives this tick (spec/loop.md, *Baton — presence wakes, absence
    // hibernates*).
    const startTokens = new Map(
      awake.map((name) => [name, this.baton.token(name)] as const),
    );

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
    // no-work failed outcome. The `flume tick` process exits
    // `EX_MOUNT_DEAD` (`src/exitCodes.ts`); the `flume loop` supervisor
    // re-reads the mount at the tip and aborts the run while a wall still
    // stands, so the remaining `--max` ticks are not burned re-hitting one —
    // and a chain an operator fixed in the gap leaves the run going.
    let chainModule: LoadedChain;
    try {
      chainModule = await this.chainLoader();
      // spec/worktrees.md "Placement — the worktree base": the declared base
      // was evaluated by the load, once, and every worktree this tick touches
      // reads that answer off `worktreeCtx`. A declaration that cannot be
      // evaluated never returns a module at all — the load throws, so it
      // lands in the refusal below rather than surfacing as a worktree at a
      // path nothing sweeps.
      this.chainWorktreesBase = chainModule.worktreesBase;
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
      const msg = thrownMessage(err);
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
    // read as `entryExtension` and `pendingDir` below, and what
    // `agentKillGraceMs` reports to a caller that has no chain of its own.
    this.bounds = resolveAgentBounds(chain.supervisorPolicy, this.tickTimeoutMs);
    // Pending parses compose core + the chain's declared entry extension —
    // remembered here because every ledger read (`src/pendingLedger.ts`) runs
    // downstream of the one place the chain is loaded, and reads it off the
    // context this class composes.
    this.entryExtension = chain.entryExtension;
    // spec/pending.md "The queue is a forest": the same per-tick read for the
    // cap the forest check reads, which is the other half of what a queue
    // parse is composed from.
    this.maxEntryDepth = chain.maxEntryDepth;
    // spec/pending.md "The pending queue": Chain.pendingDir replaces the
    // constructor-fixed default — resolved once per tick, after chain load,
    // same idiom as entryExtension above.
    this.pendingDir = resolvePendingDir(this.flumeDir, chain.pendingDir);
    // Foundations governor: a chain.ts `forkResolver` export overrides the
    // constructor default per tick, mirroring the `agent` override.
    const forkResolver = chainModule.forkResolver ?? this.opts.forkResolver;

    // Which phase this tick is: the name it was handed, or the first awake
    // one in declared order that no hold stands over. A named phase runs
    // whatever the baton says — hold included, which is the operator's own
    // explicit action (spec/loop.md, *Baton — presence wakes, absence
    // hibernates*): the request is the statement, and re-reading the flags
    // or the holds behind it would be the engine second-guessing what it was
    // told (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
    //
    // The holds are read here, where the pick is made, and again before the
    // handoff's wakes below — each at its own decision point, because a hold
    // placed mid-tick is a statement about the wake and not about the pick
    // that already happened.
    const requested = request.phase;
    // Read for the bare pick alone, and not at all for a named one: a tick
    // told which phase it is consults no marker to second-guess the telling,
    // and the decline arm below that reads this is reachable only past the
    // named request's own refusal.
    const held = requested === undefined ? this.baton.held() : [];
    const phase =
      requested === undefined
        ? chain.phases.find(
            (p) => awake.includes(p.name) && !held.includes(p.name),
          )
        : chain.phases.find((p) => p.name === requested);

    if (!phase) {
      if (requested !== undefined) {
        // A name this chain does not declare. Not orphaned-awake below (no
        // flag is involved, and nothing is left on disk to inspect) and not
        // hibernation (a named tick has no baton verdict to reach): the
        // request named a phase, the chain loaded, and the two do not meet.
        // Refused here — after the one chain load that can say what *is*
        // declared, and before the baton, the queue, or an agent.
        const declared = chain.phases.map((p) => p.name);
        const msg =
          `no phase named '${requested}'; this chain declares ` +
          (declared.length > 0 ? declared.join(", ") : "no phases");
        this.log.error(`[flume] ${msg}`);
        return {
          hibernated: false,
          failed: true,
          undeclaredPhase: { requested, declared },
          awakeAfter: awake,
          summary: msg,
        };
      }
      if (awake.length > 0) {
        // Two ways a standing flag reaches no phase, and they are not the
        // same finding. Orphans — flags naming phases this chain does not
        // declare — are read first: the misconfiguration is terminal and the
        // hold is not, so a tree with both says the thing a human has to fix
        // rather than the thing they chose.
        const declaredNames = new Set(chain.phases.map((p) => p.name));
        const orphans = awake.filter((name) => !declaredNames.has(name));
        if (orphans.length > 0) {
          // Axis C: an awake flag names a phase the chain does not
          // declare. Not Axis B (nothing here is quiescent — the flags persist)
          // and not Axis A (no agent ran, nothing to retry). The flags stay on
          // disk so the human inspects, then `flume sleep <phase>` or fixes
          // the chain; clearing them would be a silent ack.
          const msg =
            `awake flags reference unknown phases: ${orphans.join(", ")}; ` +
            `terminal misconfiguration (orphaned-awake), flags left on disk`;
          this.log.error(`[flume] ${msg}`);
          return {
            hibernated: false,
            terminal: { kind: "orphaned-awake", phases: orphans },
            awakeAfter: awake,
            summary: msg,
          };
        }
        // Every flag standing names a declared phase, and a hold stands over
        // each of them: a bare tick does not run a held phase, so this tick
        // has no work (spec/loop.md, *Baton — presence wakes, absence
        // hibernates*). A clean no-op, not a failure and not hibernation —
        // the flags stand, so the loop has work the moment the operator
        // lifts a hold, and `flume tick --phase <name>` runs one now.
        //
        // The flags are left exactly as they are. Sleeping them here would
        // be the engine acknowledging a hold on the operator's behalf and
        // losing the queued run they stand for.
        const heldAwake = awake.filter((name) => held.includes(name));
        const msg =
          `every awake phase is held: ${heldAwake.join(", ")}; ` +
          `no work this tick — \`flume tick --phase <name>\` runs a held ` +
          `phase, or lift the hold`;
        this.log.info(`[flume] ${msg}`);
        return {
          hibernated: false,
          heldPhases: heldAwake,
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

    // The tick's prompt template, loaded here — one read, beside the one
    // chain load above, and the string every slot below renders from
    // (spec/loop.md, *One tick is one fresh process*). A wave that refills
    // can outlast a ship that rewrote this file on trunk; taking the bytes
    // now is what keeps the words an agent is handed and the code that filled
    // them one version, rather than re-reading the primary checkout at each
    // slot.
    //
    // A prompt file that cannot be read ends the tick here, before any
    // worktree is provisioned: no slot of this phase had a prompt, so the
    // refusal is the whole tick's. Reported rather than thrown — a raw stack
    // out of this call reached `main().catch` and exited 1, which told the
    // supervisor to spend its remaining children on an input that resolved
    // once and resolves the same way every time. The narrowing is read off
    // the load's own class, never guessed from an errno's prose
    // (`PromptTemplateUnreadableError`, `src/Prompt.ts`); everything else out
    // of the call is an ordinary throw and keeps propagating.
    let promptTemplate: string;
    try {
      promptTemplate = await readPhaseTemplate(
        this.opts.configDir,
        phase.promptPath,
      );
    } catch (err) {
      if (!(err instanceof PromptTemplateUnreadableError)) throw err;
      const msg = `${phase.name}: ${err.message}; this tick does no work`;
      this.log.error(`[flume] ${msg}`);
      return {
        hibernated: false,
        failed: true,
        phaseName: phase.name,
        promptUnreadable: {
          promptPath: err.promptPath,
          resolvedPath: err.resolvedPath,
        },
        // Nothing moved the baton: the phase this tick selected is still
        // awake, and the work it owes is still owed.
        awakeAfter: awake,
        summary: msg,
      };
    }
    const legCtx = this.legCtxFor(promptTemplate);

    // spec/loop.md "Every agent invocation leaves a usage row": a row reaches
    // disk when its agent returns, so the file this phase appends to is one
    // tick's and the stale one a previous tick of this phase left is cleared
    // here — after the phase is chosen and before either leg runs, which is
    // the last moment at which no agent of this tick has been paid for.
    // Scoped to this phase: a supervisor run holds one child per awake phase,
    // and a live sibling's rows are spend already paid.
    await clearInvocationRows(this.flumeDir, phase.name);

    this.log.info(`[flume] tick → ${phase.name} (${phase.concurrency})`);

    let phaseOutcome: PhaseTickOutcome;
    try {
      phaseOutcome =
        phase.concurrency === "singleton"
          ? await runSingleton(legCtx, phase, agent, chain, forkResolver)
          : await runFanout(legCtx, phase, agent, chain, forkResolver);
    } catch (err) {
      // Two throws reach here, and neither leaves this tick any more work to
      // do. A bare `PendingParseFailure` is the *opening* decide-read
      // refusing before any agent ran, because this phase's declared fence
      // does not admit the ledger (`readPendingForDecision`,
      // `src/pendingLedger.ts`, whose reason `err.message` carries); its
      // repair is a tick of the phase that *does* declare the queue writable,
      // which the decide-read's carve-out lets run over exactly this file
      // (spec/pending.md, "Queue reads are strict"). The claim that no agent
      // ran is this arm's because a wave's own throws arrive wrapped: a wave
      // torn down after its picks landed leaves as a `WaveCarriedThrow`
      // carrying the spans already on trunk and a usage row per agent that
      // ran — a slot leg that threw and the merge stage alike, ranked into the
      // one class this arm reads (`waveWallThrow`, `src/waveMerge.ts`). That is
      // the other throw — a ledger read or write that refused, and equally an
      // agent that exploded, a hook that threw, a render that did not resolve,
      // a merge marker the disk would not take; the `cause` says which, and
      // the facts it carries are the same in every case, which is why the
      // carry is not keyed on one of them.
      //
      // Everything else is an ordinary throw and keeps propagating. Both arms
      // are `failed: true` and neither is softened — but they are not one
      // exit class, and the narrowing is read off the carry rather than
      // guessed here: `WaveLedgerRefusal` is the subclass whose cause really
      // was a pending-ledger refusal and states its own classification out to
      // `tickExitCode`, so a queue nothing can parse stays mount-dead while a
      // ledger commit git refused is the ordinary harness error it is. A
      // carry that is no ledger refusal reports none, and `tickExitCode`
      // reads its verdict instead (`src/cliVerdict.ts`) — the harness error a
      // bare re-throw out of this call already exited with. A bare
      // `PendingParseFailure` is a parse failure by its own type.
      if (
        !(err instanceof PendingParseFailure) &&
        !(err instanceof WaveCarriedThrow)
      ) {
        throw err;
      }
      this.log.error(`[flume] ${err.message}`);
      const carried = err instanceof WaveCarriedThrow ? err : undefined;
      const ledgerRefusal: LedgerRefusalClass | undefined =
        carried === undefined
          ? "parse-failure"
          : carried instanceof WaveLedgerRefusal
            ? carried.refusalClass
            : undefined;
      return {
        hibernated: false,
        failed: true,
        awakeAfter: this.baton.awake(),
        summary: err.message,
        ...(ledgerRefusal !== undefined ? { ledgerRefusal } : {}),
        ...(carried !== undefined ? { verdict: carried.verdict } : {}),
        // Every record bucket the wave filed, read off the verdict the wave
        // itself built rather than re-selected here, through the one
        // projection the completing arm below takes: `summary` and
        // `ledgerRefusal` above name a single wall, and this is the rest of
        // what the same wave held — the walls its ranking did not class
        // (`waveWall`, `src/waveMerge.ts`) beside the stage failures its legs
        // recorded, each on the field this shape already declares for it. A
        // supervisor reading the handoff sees them without opening the
        // verdict file.
        ...(carried !== undefined ? mirrorFailureBuckets(carried.verdict) : {}),
      };
    }
    const {
      result,
      noCommit,
      tipMoved,
      declined,
      bystanderCheckpointSha,
      provisionFailures,
      stakeLosses,
      renderFailures,
      mergeFailures,
      gateFailures,
      platformFailures,
      shipFailures,
      tags,
      mergeOutcomes,
      timings,
      clearedPriorAttempts,
    } = phaseOutcome;

    // Fold the already-computed no-commit classification and the render-,
    // merge- and gate-stage failures into the TickResult before handoff.
    // Provision-stage records are not folded here: the wave put them on
    // `result` as it dropped the entry, one stage before a prompt was
    // rendered for it. A chain's `handoff` is the only place a clean-exit
    // wave can be distinguished from a genuine no-op, and the only place the
    // entry a failing gate reverted is named (`gateResults` carries the rows
    // untagged, in run order, with no signature and no record of which
    // failures the engine blamed an entry for). The merge-stage fold is the
    // same shortfall one stage earlier: an entry's `mergeOutcome` names the
    // fate and the span, never git's refusal or the signature a repeat is
    // recognized by. The render-stage fold is that shortfall one earlier
    // again: a prompt that never resolved ran no agent, so nothing else on
    // the surface names the entry it was blamed on.
    //
    // The ship-stage fold is the same shortfall one stage later: an entry's
    // `mergeOutcome` reads `not-shipped` whether the chain's predicate
    // declined or threw, so a handoff separating a deliberate park from a
    // broken hook off that field alone would be rebuilding a split the engine
    // already made.
    //
    // The platform-stage fold is the shortfall with no per-entry trace at all:
    // an agent that died for non-work reasons ran no gate, reached no pick and
    // wrote its class only into the prior-attempt slot the *retry's prompt*
    // reads, so a `handoff` counting host walls has nothing else to read.
    //
    // `tipMoved` does NOT fold in here: `TickResult`
    // (`src/Phase.ts`) carries no field for it — the fact lives on
    // `TickOutcome`/`TickVerdict` alone, read by a fresh next tick, never by
    // this same tick's synchronous `handoff`.
    //
    // Every fold reads the same values the verdict below is built from, so
    // the handoff surface and the persisted artifact cannot disagree about
    // which stage refused what (`.claude/rules/engineering.md`, *A fact the
    // engine holds is reported, never rediscovered*).
    const resultForHandoff: TickResult = {
      ...result,
      ...(noCommit ? { noCommit } : {}),
      ...(renderFailures && renderFailures.length > 0
        ? { renderFailures }
        : {}),
      ...(mergeFailures && mergeFailures.length > 0 ? { mergeFailures } : {}),
      ...(gateFailures && gateFailures.length > 0 ? { gateFailures } : {}),
      ...(platformFailures && platformFailures.length > 0
        ? { platformFailures }
        : {}),
      ...(shipFailures && shipFailures.length > 0 ? { shipFailures } : {}),
    };

    // Sleep this phase by default; handoff re-wakes if needed. Scoped to the
    // token this tick read at its start: a sibling that woke this phase while
    // the work above ran left a newer one, and that wake is a run this phase
    // owes, not a level this tick may clear. The sleep declines, the flag
    // stands, and the next tick carries it.
    if (!this.baton.sleepIfUnchanged(phase.name, startTokens.get(phase.name)))
      this.log.info(
        `[flume] ${phase.name}: a wake landed during this tick; phase stays awake`,
      );
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
    // Which of the names the handoff returned the engine actually wakes, and
    // what declined the rest. Two standing reasons, each read off a
    // statement rather than guessed at: the chain's own `humanOnly`
    // declaration, and the operator's hold markers on disk
    // (spec/loop.md, *Baton — presence wakes, absence hibernates*).
    //
    // The holds are re-read here, not carried down from the pick at the top
    // of this tick: a hold placed while the phase's work ran is placed
    // precisely to stop the wake this line is about, and a set read minutes
    // ago would wake over it. Disk is truth at the moment of the decision.
    //
    // Every decline is a row, never a silent filter — including `humanOnly`,
    // which dropped names without a word before. A handoff asking for a
    // successor and getting none is otherwise indistinguishable, from
    // `awakeAfter` alone, from a handoff that asked for nothing
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*). A name the handoff returned twice is two rows:
    // the engine states what it was handed, and does not dedupe a
    // counterparty's list on its behalf.
    const heldAtHandoff = this.baton.held();
    const allowed: string[] = [];
    const declinedWakes: DeclinedWake[] = [];
    for (const name of handoff) {
      const reason: WakeDeclineReason | undefined = chain.humanOnly.includes(
        name,
      )
        ? "human-only"
        : heldAtHandoff.includes(name)
          ? "held"
          : undefined;
      if (reason === undefined) allowed.push(name);
      else declinedWakes.push({ phase: name, reason });
    }
    for (const name of allowed) this.baton.wake(name);
    if (declinedWakes.length > 0)
      this.log.info(
        `[flume] ${phase.name}: handoff wake declined for ` +
          `${declinedWakes.map((d) => `${d.phase} (${d.reason})`).join(", ")}`,
      );

    const summary = summarize(
      phase.name,
      result,
      allowed,
      noCommit,
      tipMoved,
      declined,
      declinedWakes,
    );

    // The unified facts artifact — a pure value, built here so
    // `TickOutcome` carries everything the CLI's `tick` command needs to
    // persist it verbatim via `writeTickVerdict`. Building it is not itself
    // a disk write (the concern `writeTickVerdict`'s own doc names for
    // `Dispatcher.tick()` unit tests), so it costs the existing computed
    // fields (`summary` et al.) nothing extra.
    //
    // headSha (spec/loop.md "The tick verdict — one facts artifact"): the
    // trunk tip read here, after this phase's own commits (if any) already
    // landed — never inferred from which paths the last commit touched, and
    // left behind even on a quiet no-commit tick. The shaping itself, `at`
    // included, is `buildTickVerdict`'s (`src/tickVerdict.ts`), shared with
    // the partial verdict a walled wave rides out on — every throw its merge
    // stage holds and every throw out of a slot's own leg alike
    // (`waveWallThrow`, `src/waveMerge.ts`), not the refused ledger rewrite
    // alone.
    const verdict = buildTickVerdict({
      phaseName: phase.name,
      tags: tags ?? [],
      committed: result.committed,
      noCommit,
      tipMoved,
      declined,
      bystanderCheckpointSha,
      gateResults: result.gateResults,
      shippedTags: result.shippedTags,
      mergeOutcomes,
      // spec/loop.md "Every agent invocation leaves a usage row": composed
      // from the rows each agent wrote as it returned, never from a list the
      // legs carried back — the rows on disk are the set, and the verdict
      // states them rather than keeping a second copy
      // (`.claude/rules/engineering.md`, *Derived state is computed, never
      // restated beside its source*).
      invocations: await readInvocationRows(this.flumeDir, phase.name),
      // spec/loop.md "The tick verdict — one facts artifact": what this tick
      // spent off the agent's clock, from the leg that measured it — the same
      // rows the wave's refusal verdict carries, so the completing and the
      // refused producer report one fact set.
      timings,
      provisionFailures,
      // The wave's lost stake races, on the artifact the next tick reads —
      // the same records `result.stakeLosses` already handed `handoff`, so
      // the two surfaces cannot disagree about which entries a sibling took.
      stakeLosses,
      renderFailures,
      mergeFailures,
      gateFailures,
      platformFailures,
      shipFailures,
      clearedPriorAttempts,
      declinedWakes,
      // spec/loop.md "The tick verdict — one facts artifact": off the leg's
      // own `TickResult`, which is where the hold that read it put it — one
      // home for the fact, so the handoff surface and the artifact beside it
      // cannot disagree about which tip this tick's last ship left
      // (`.claude/rules/engineering.md`, *Derived state is computed, never
      // restated beside its source*) — either leg's, since a singleton's ship
      // is its merged span and a wave's is its ledger commit. Absent on any
      // tick that shipped nothing, and on one whose ledger rewrite a foreign
      // tip claim stopped.
      gatedTip: result.gatedTip,
      summary,
      headSha: await git.revParse(this.opts.repoRoot),
    });

    return {
      hibernated: false,
      phaseName: phase.name,
      result: resultForHandoff,
      verdict,
      ...(noCommit ? { noCommit } : {}),
      ...(tipMoved ? { tipMoved } : {}),
      ...(declined ? { declined } : {}),
      // The stage records, off the verdict built just above rather than
      // re-tested against the locals it was built from: one projection, the
      // walled arm's too, so this surface and the artifact beside it cannot
      // disagree about which stage refused what, and neither arm can be the
      // one a later bucket is added to.
      ...mirrorFailureBuckets(verdict),
      awakeAfter: this.baton.awake(),
      summary,
    };
  }

  // ---------- render: the resolution path, short of the invocation ----------

  /**
   * The prompt one tick would be handed, resolved without invoking anything —
   * `flume render`'s whole body (spec/cli.md, *Subcommand surface*).
   *
   * Every step below is the tick's own: `chainLoader`,
   * `readPendingForDecision` (`src/pendingLedger.ts`),
   * `pickableSelection`, `partitionByFileOverlap`, `attempts.readAll`,
   * `readPhaseTemplate`, `renderPrompt`. The verb this replaces re-derived
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
    // The same per-tick rebinds `tick()` takes off a freshly-loaded chain,
    // for the same readers: the ledger read's parse and its path.
    this.entryExtension = chain.entryExtension;
    this.maxEntryDepth = chain.maxEntryDepth;
    this.pendingDir = resolvePendingDir(this.flumeDir, chain.pendingDir);

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

    // The tick's own decide-read, carve-out included (spec/pending.md, "Queue
    // reads are strict"): a preview of a phase that could repair an
    // unparseable queue must resolve the prompt that repair is rendered from,
    // and a preview of a phase that could not must refuse exactly where the
    // tick would.
    const { pending, filingTimes, queueParseFailure } =
      await readPendingForDecision(this.ledgerCtx, phase);
    const isForkResolved =
      (chainModule.forkResolver ?? this.opts.forkResolver)?.(
        this.opts.repoRoot,
      ) ?? (() => true);
    // The two facts a chain's declared per-entry refusal is judged against,
    // read here because the selection below is where they are consulted — the
    // same map the context carries further down, so a preview asks the
    // chain's predicate about exactly the records a tick would.
    const priorAttempts = await this.attempts.readAll();
    // And the third fact the selection is taken against: the entries a live
    // tick is carrying right now (spec/pending.md, "Claims — an entry in
    // flight is left alone"). A preview that ignored them would show an
    // entry as the one the next wave picks first while a sibling is already
    // building it.
    const claimedSlugs = await this.claims.readLive();
    // The selection a fanout tick would make on this queue, under this
    // chain's declared knobs — taken from the one derivation `runFanout`
    // runs, never re-spelled here (.claude/rules/engineering.md, "A module
    // is one job").
    const { pickable, batches, claimedTags } = this.selection({
      chain,
      queue: { pending, filingTimes },
      isForkResolved,
      refusalFacts: {
        priorAttempts,
        headSha: await git.revParse(this.opts.repoRoot),
      },
      claimedSlugs,
      // A preview runs no wave, so this chain's own sequencing policy is
      // handed the empty in-flight set a tick's opening selection is handed
      // (`OrderContext.inFlight`, `src/Phase.ts`) — which is what makes the
      // entry below the one that wave would carry first.
      inFlight: [],
    });

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

    // The steps a fanout slot's span would ship, off the queue this preview
    // already read — the engine's own walk over `parent` links, the one a
    // wave's selection hands its slot (`ShipContext.steps`, `src/Phase.ts`),
    // so a preview and the tick that follows it name one listing.
    const steps = entry === undefined ? [] : descendantsOf(pending, entry.tag);
    // Each concurrency's own context, field for field — a singleton reads the
    // whole queue and carries no assignment, a fanout entry carries its
    // assignment and its steps and no queue. A preview that widened either
    // would show the chain a `promptArgs` input the tick never gets.
    const ctx: TickContext = {
      cwd: this.opts.repoRoot,
      flumeDir: this.flumeDir,
      stateRootRel: this.stateRootRel,
      pickable,
      claimed: claimedTags,
      priorAttempts,
      ...(entry !== undefined
        ? { assignedEntry: entry, assignedSteps: steps }
        : { pending }),
      ...(queueParseFailure ? { queueParseFailure } : {}),
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
      // The same load a tick makes, one call short of the same render.
      template: await readPhaseTemplate(this.opts.configDir, phase.promptPath),
      cwd: this.opts.repoRoot,
      args,
      // The steps ride the render too, because the `<harness>` block states
      // the effective fence — the entry's files and its steps' together — and
      // a preview naming the entry alone would show a scope narrower than the
      // guard the tick enforces.
      ...(entry !== undefined
        ? { assignedEntry: entry, assignedSteps: steps }
        : {}),
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
   * method because `flume loop` reaches it through the
   * Dispatcher they already hold (`src/cliLoop.ts`), after the tip claim is
   * acquired and before the first tick.
   */
  async sweepStaleWorktrees(): Promise<void> {
    // The sweep runs before the first tick, so nothing has loaded a chain
    // into this process yet — and the base it sweeps has to be the base the
    // ticks create under, or it reads an empty directory and leaves every
    // abandoned worktree, and the branch each was checked out on, standing
    // where creation put them
    // (spec/worktrees.md, *Placement — the worktree base*: the base is
    // resolved once). Hence the load here rather than a value the caller
    // passes: the base is the load's answer, read off the loaded module at
    // the one spelling `tick` reads it at.
    //
    // Declared degradation (`.claude/rules/engineering.md`, *Loud or
    // nothing*): a chain that will not load — including one the load refuses
    // over its `worktreesBase` — leaves the engine's own base swept, silently.
    // The refusal that bounds it is `tick`'s: the very next thing this run
    // does is load the same chain through the same spelling, and it names the
    // failure and does no work. A chain that cannot run creates no worktree under any
    // base, so there is nothing at the declared one for this sweep to have
    // missed — and a second copy of that message here would break the one
    // thing an operator reads this sweep's output for, which is silence when
    // there was no residue.
    try {
      this.chainWorktreesBase = (await this.chainLoader()).worktreesBase;
    } catch {
      // bounded above
    }
    await sweepStaleWorktrees(this.worktreeCtx);
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
  declinedWakes?: readonly DeclinedWake[],
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
  // A declined wake rides the one-liner because the arrow above lies without
  // it: a handoff whose only successor is held reads as `→ hibernate`, which
  // is the chain ending the run and not the operator holding one phase of it.
  if (declinedWakes && declinedWakes.length > 0)
    parts.push(
      `(declined ${declinedWakes.map((d) => `${d.phase}: ${d.reason}`).join(", ")})`,
    );
  return parts.join(" ");
}
