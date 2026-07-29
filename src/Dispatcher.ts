/**
 * Dispatcher — the runtime. Reads baton, picks the awake phase, builds the
 * TickContext, invokes the agent, runs gates, decides handoff.
 *
 * One Dispatcher instance per repo. Stateless across ticks (everything it
 * needs comes from disk). `tick()` runs exactly one phase × one (or N for
 * fanout) agent invocation(s). `loop()` runs `tick()` until hibernation.
 */

import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  rename,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { tsImport } from "tsx/esm/api";

import type { Agent } from "./Agent.js";
import { Baton } from "./Baton.js";
import type { Gate, GateResult } from "./Gate.js";
import { writablePathsGate } from "./builtinGates.js";
import { partitionByFileOverlap } from "./partition.js";
import { parsePending } from "./PendingSchema.js";
import type { PendingEntry } from "./PendingSchema.js";

/** Local-mutable shape for accumulating gate results before they widen to TickResult.gateResults. */
type GateResultEntry = { gate: string; ok: boolean; message: string };
import type { Chain, Phase, TickContext, TickResult } from "./Phase.js";
import { renderPrompt } from "./Prompt.js";
import type {
  PriorAttempt,
  GateRevertAttempt,
  VoluntaryBailAttempt,
  PlatformPreemptAttempt,
  NoCommitMode,
} from "./Prompt.js";
import * as git from "./git.js";

const execFileP = promisify(execFile);

/**
 * Prior-attempt records live beside the baton (`<flumeDir>/awake/`) —
 * gitignored harness runtime state under the flume state dir, NOT in the
 * per-entry worktree (a fanout retry gets a fresh worktree; the record must
 * outlive it). One JSON file per key: the entry tag slug (fanout) or phase
 * name (singleton).
 *
 * Session logs sit alongside under the same root (the dogfood chain places
 * them at `<flumeDir>/sessions/`), but that placement is chain-supplied, not
 * runtime: the runtime owns only `flumeDir` itself and the baton/prior-attempt
 * dirs it derives from it. A chain that captures sessions roots them under
 * `process.env.FLUME_DIR` so the whole footprint tears down in one `rm`.
 */
const PRIOR_ATTEMPTS_SUBDIR = "prior-attempts";

/** Telegraphic-prose bound on persisted gate details — a digest, not a transcript. */
const MAX_PRIOR_DETAILS = 8 * 1024;
/** Bound on the persisted `git show --stat` digest. */
const MAX_PRIOR_DIFFSTAT = 4 * 1024;
/**
 * Bound on the persisted voluntary-bail constraint / platform-preempt
 * failure class. Same telegraphic discipline as the gate digest: enough to
 * name the wall, not the transcript.
 */
const MAX_PRIOR_NOCOMMIT = 4 * 1024;

/**
 * How an agent invocation ended — consulted by §6 classification ONLY when
 * the tick produced no commit. A clean exit with no commit is a
 * voluntary-bail (the agent refused a constraint and said so in its final
 * message, captured here as `stdout`); any process failure is a
 * platform-preempt (not a defect in the work). When a commit landed, how the
 * process ended is irrelevant — the commit is honored regardless.
 */
type AgentTermination =
  | { kind: "clean"; stdout: string }
  | { kind: "process-failure"; failureClass: string };

/** Filesystem-safe slug for a pending tag — shared by worktree + prior-attempt keying. */
function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

/** Cap a string to `max` chars, marking the elision so truncation is visible. */
function bound(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

/**
 * Keep the *last* `max` chars (the agent's final message — where a bail
 * names its refused constraint — lives at the tail of stdout), marking the
 * elision at the head so truncation is visible.
 */
function tailBound(s: string, max: number): string {
  if (s.length <= max) return s;
  return `[truncated ${s.length - max} chars]…\n` + s.slice(s.length - max);
}

// ---------- public surface ----------

/**
 * Three-level logging seam. The dispatcher writes harness narration through
 * these methods; consumers can route them to a structured logger or simply
 * pass `consoleLogger` (the default).
 */
export interface Logger {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/**
 * Default `Logger` implementation: `info` → `console.log`, `warn` →
 * `console.warn`, `error` → `console.error`. Used by the dispatcher when
 * `DispatcherOptions.log` is omitted.
 */
export const consoleLogger: Logger = {
  info: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

/**
 * The shape `.flume/chain.ts` resolves to: a default-exported `Chain` plus an
 * optional `agent` override and an optional `forkResolver` (the foundations
 * governor, §v0.3). The per-tick resolver returns this; a rewritten chain.ts
 * changes the chain (and any `agent`/`forkResolver` export) for the next tick.
 *
 * Exporting `forkResolver` from chain.ts is how a stock-CLI consumer supplies
 * the governor's resolution predicate — it overrides `DispatcherOptions.forkResolver`
 * per tick exactly as `agent` overrides the default agent.
 */
export interface ChainModule {
  default: Chain;
  agent?: Agent;
  forkResolver?: (repoRoot: string) => (slug: string) => boolean;
}

/**
 * Load + normalize + validate a chain module from an absolute `chain.ts`
 * path. Throws on a missing file, a compile/syntax error, or a shape that
 * isn't a Chain (no resolvable default export, or `phases` not an array).
 *
 * This is the single load+validate path the runtime trusts. `diskChainLoader`
 * wraps it (one load per call, no memo); `chainLoadGate` (builtinGates) calls
 * it to validate a just-committed `chain.ts` so a broken self-edit fails its
 * gate and is reverted before the next tick's process resolves it.
 *
 * tsImport (tsx/esm/api) compiles the .ts source in-process so the published
 * dist/cli.js can resolve consumer chain.ts files without a node loader flag
 * (plain `await import()` would fail: node refuses .ts under node_modules,
 * and consumer .flume/chain.ts is a .ts file regardless of where flume lives).
 *
 * In-process this returns a *pinned* evaluation: Node's ESM module registry
 * is keyed by resolved URL and is non-evictable, so a fixed-path chain.ts is
 * frozen to its first load for the life of the process (verified on tsx 4.21
 * / Node 22.21 — no query string, tsImport namespace, or loader
 * re-registration evicts it). That is *why* per-tick re-resolution is a
 * process boundary, not in-process re-eval: `flume loop` spawns one
 * `flume tick` per iteration (§2), each a fresh process that loads chain.ts
 * exactly once. A rewritten chain.ts governs the next tick because the next
 * tick is a new process — not because anything re-imports it in-process.
 */
/**
 * Validate a declared `Chain.friction` (§2, v0.6.2): must be relative and
 * must resolve inside the state root, else a usage-shaped error. The check
 * is base-independent — it resolves the declared path against an arbitrary
 * sentinel root and asks whether the result still sits under that root —
 * so it needs no actual `flumeDir` value. That value legitimately varies
 * per call site (a job-scoped run's state root differs from `configDir`,
 * where `chain.ts` itself lives), but "does this relative path escape
 * whatever root it's joined to" is a property of the path string alone.
 * Undeclared `friction` is a strict no-op, per §2.
 */
function validateFrictionDeclaration(chain: Chain): void {
  if (chain.friction === undefined) return;
  const friction = chain.friction;
  if (isAbsolute(friction)) {
    throw new Error(
      `chain declares friction '${friction}' as an absolute path; ` +
        `Chain.friction must be a state-root-relative directory path (e.g. "friction")`,
    );
  }
  const sentinelRoot = resolve("__flume_state_root__");
  const resolved = resolve(sentinelRoot, friction);
  const rel = relative(sentinelRoot, resolved);
  const escapesRoot =
    rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapesRoot) {
    throw new Error(
      `chain declares friction '${friction}' which resolves outside the state root; ` +
        `Chain.friction must be a state-root-relative directory path (e.g. "friction")`,
    );
  }
}

/**
 * The friction count line shared by `flume status`, `flume job status`, and
 * the loop-end summary (§6, v0.6.2): count of files directly under the
 * declared friction dir, resolved against `stateRoot` — whichever state
 * root is in play for the caller (the repo's `flumeDir`, or a job's dir).
 * `undefined` when `Chain.friction` is undeclared, the dir is absent, or it
 * holds no files — callers print a line only when this resolves to a
 * string (§6: "when declared and non-empty").
 */
export async function frictionCountLine(
  stateRoot: string,
  chain: Chain,
): Promise<string | undefined> {
  if (chain.friction === undefined) return undefined;
  let entries: Dirent[];
  try {
    entries = await readdir(join(stateRoot, chain.friction), {
      withFileTypes: true,
    });
  } catch {
    return undefined;
  }
  const count = entries.filter((e) => e.isFile()).length;
  return count > 0 ? `friction: ${count} note(s) await routing` : undefined;
}

export async function loadChainModule(path: string): Promise<ChainModule> {
  if (!existsSync(path)) {
    throw new Error(
      `chain config not found at ${path}; create .flume/chain.ts that default-exports a Chain.`,
    );
  }
  const ns = (await tsImport(
    pathToFileURL(path).href,
    import.meta.url,
  )) as Record<string, unknown>;

  // tsx compiles a default-ONLY .ts module to CJS interop, so the namespace
  // is { default: { __esModule: true, default: <realDefault> } }. A module
  // with named exports stays true ESM: ns.default is the value directly and
  // named exports are siblings on ns. Normalize both shapes — the documented
  // minimal chain (default export only) hits the interop path.
  const d = ns.default as Record<string, unknown> | undefined;
  const interop =
    !!d &&
    (d as { __esModule?: boolean }).__esModule === true &&
    "default" in d;
  const chain = (interop ? d!.default : d) as Chain | undefined;
  const agent = (ns.agent ?? (interop ? d!.agent : undefined)) as
    | Agent
    | undefined;
  const forkResolver = (ns.forkResolver ??
    (interop ? d!.forkResolver : undefined)) as
    | ((repoRoot: string) => (slug: string) => boolean)
    | undefined;

  if (!chain || !Array.isArray((chain as { phases?: unknown }).phases)) {
    throw new Error(
      `${path} must default-export a Chain (an object with a phases[] array)`,
    );
  }
  validateFrictionDeclaration(chain);
  const module: ChainModule = { default: chain };
  if (agent) module.agent = agent;
  if (forkResolver) module.forkResolver = forkResolver;
  return module;
}

/**
 * Build the default per-tick chain resolver: load `<configDir>/chain.ts` via
 * `loadChainModule`, once per call. No memoization — each `flume tick` is a
 * fresh process (§2), so there is exactly one resolution per process and
 * nothing to memoize across. The prior content-hash cache was an in-process
 * optimization for a mechanism (in-process reload) that cannot deliver the
 * re-resolution guarantee; cost is one small `tsImport` per tick, dominated
 * by orders of magnitude by the agent invocation.
 *
 * Injecting `DispatcherOptions.chainLoader` replaces this wholesale — the
 * in-process unit-test seam (tests call `tick()` directly, no subprocess).
 */
export function diskChainLoader(configDir: string): () => Promise<ChainModule> {
  return () => loadChainModule(resolve(configDir, "chain.ts"));
}

/**
 * Constructor input for `Dispatcher`. `repoRoot`, `configDir`, and `agent`
 * are required; the rest tune chain resolution, concurrency, trunk
 * identification, logging, and per-tick wall-clock budget.
 *
 * No prebuilt `Chain` is accepted — the dispatcher resolves
 * `<configDir>/chain.ts` once at the start of its tick. Re-resolution across
 * ticks is a process boundary, not in-process: `flume loop` spawns one
 * `flume tick` per iteration (§2), so a tick that rewrites the chain is
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
   * Fanout branch namespace (v0.5 §4). When set, ephemeral worktree branches
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
   * `phase.agent ?? chainModule.agent ?? this` — a `chain.ts` that exports
   * `agent` overrides this (the agent re-resolves with the chain), and a
   * phase carrying its own `agent` overrides both for its ticks.
   */
  agent: Agent;
  /**
   * Chain resolver, invoked once per tick. Defaults to
   * `diskChainLoader(configDir)` (one load of `<configDir>/chain.ts` per
   * process). Override for in-process test injection only (no subprocess).
   */
  chainLoader?: () => Promise<ChainModule>;
  /**
   * Foundations governor (§v0.3). Given the repo root, returns a predicate
   * answering "is this open-question fork resolved?". Consulted once per tick;
   * an entry whose `dependsOnForks` contains any unresolved slug is not
   * pickable, skipped in favour of a foundation-settled sibling (or the tick
   * idles if none). Default: every fork resolved — a chain that supplies no
   * resolver is behaviourally identical to v0.2. The runtime stays
   * format-agnostic: how a project records and resolves forks lives in the
   * resolver, not here.
   */
  forkResolver?: (repoRoot: string) => (slug: string) => boolean;
  log?: Logger;
  /** Max parallel ticks per fanout batch. Default 4. */
  maxParallel?: number;
  /**
   * Wall-clock timeout per agent invocation in milliseconds. When exceeded,
   * the underlying agent process is aborted; the dispatcher logs a warning
   * and the tick continues with whatever the agent committed (typically
   * nothing, so the phase falls through with `committed: false`). Default:
   * unset — a hung agent will block the tick indefinitely.
   */
  tickTimeoutMs?: number;
}

/**
 * `flume tick` exit code for an Axis-C terminal misconfiguration (§3):
 * sysexits.h `EX_CONFIG`. Distinct from 0 (clean hibernate) and 1 (chain
 * resolution failure) so the process boundary classifies the failure without
 * reading logs. `superviseLoop` fail-fasts on a child exiting with this code.
 */
export const EX_TERMINAL_MISCONFIG = 78;

/**
 * Axis-C terminal misconfiguration (§3): the declared world is inconsistent —
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
   * `chainLoadGate` reverted the producing commit (§3). The `flume tick`
   * process exits non-zero; the `flume loop` supervisor logs it and proceeds
   * to the next tick (a fresh process re-reads `chain.ts`). Distinct from
   * `hibernated` (clean stop) and from a no-commit tick (the agent ran but
   * produced or kept no commit).
   */
  failed?: boolean;
  /**
   * For a no-commit tick where an agent ran (§6): which of the three
   * causally-distinct modes produced no usable commit —
   *  - `gate-revert`      a commit was made then a gate reverted it,
   *  - `voluntary-bail`   the agent exited cleanly without committing
   *                       (a constraint it refused to cross),
   *  - `platform-preempt` the agent process failed for non-work reasons
   *                       (rate-limit, auth, timeout, dispatcher-killed) —
   *                       NOT a defect in the work.
   * Absent when the tick shipped a usable commit, hibernated, `failed`
   * (chain resolution threw), or ran no agent (nothing pickable). For a
   * fanout wave it is the representative cause when the whole wave shipped
   * nothing (precedence gate-revert > platform-preempt > voluntary-bail —
   * §6's stated harm is platform failures masquerading as agent failures,
   * so platform-preempt outranks voluntary-bail in the wave summary); each
   * entry's own mode is persisted to its §5 prior-attempt record (the
   * durable per-entry channel §6 mandates for telling voluntary-bail loops
   * from platform-preempt runs without reading session logs).
   */
  noCommit?: NoCommitMode;
  /**
   * Axis-C terminal misconfiguration (§3) — sibling of `hibernated` /
   * `failed`, never a `NoCommitMode` member (no agent ran, no entry exists
   * to retry). Set when every awake flag names a phase the chain does not
   * declare. The flags are deliberately left on disk: clearing them would
   * convert the misconfiguration into a silent clean stop. `flume tick`
   * exits {@link EX_TERMINAL_MISCONFIG} when this is set.
   */
  terminal?: TerminalMisconfiguration;
  /** Phase names awake after this tick. */
  awakeAfter: string[];
  /** One-line summary suitable for log output. */
  summary: string;
}

/**
 * Runtime that wires baton + chain + agent + gates into one tick. Stateless
 * across ticks (everything it needs comes from disk). `tick()` runs exactly
 * one phase × one invocation (or N for fanout); `loop()` repeats until
 * hibernation or `maxTicks`.
 */
export class Dispatcher {
  private readonly opts: DispatcherOptions;
  private readonly baton: Baton;
  private readonly log: Logger;
  private readonly maxParallel: number;
  private readonly tickTimeoutMs: number | undefined;
  private readonly flumeDir: string;
  private readonly pendingPath: string;
  private readonly chainLoader: () => Promise<ChainModule>;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.flumeDir = opts.flumeDir ?? join(opts.repoRoot, ".flume");
    this.baton = new Baton(this.flumeDir);
    this.log = opts.log ?? consoleLogger;
    this.maxParallel = opts.maxParallel ?? 4;
    this.tickTimeoutMs = opts.tickTimeoutMs;
    this.pendingPath = join(this.flumeDir, "plan", "pending.json");
    this.chainLoader = opts.chainLoader ?? diskChainLoader(opts.configDir);
  }

  /** Run one phase × one tick. Returns hibernated outcome if nothing awake. */
  async tick(): Promise<TickOutcome> {
    const awake = this.baton.awake();

    // Disk is truth: this process resolves chain.ts exactly once, here. A
    // prior tick that rewrote chain.ts is governed by the new chain because
    // *this is a new process* (the supervisor spawned it) — not via any
    // in-process reload. The chain's optional `agent` export resolves with it.
    //
    // Engine resolution-failure fallback (§3): there is no in-process
    // "last-good chain" to retain — recovery is structural, not in-memory. A
    // chainLoadGate-guarded broken chain.ts is reverted by its producing
    // tick, so the next tick's fresh process reads the restored file. An
    // *unguarded* broken chain.ts has nothing to run: log loudly and return a
    // no-work failed outcome. The `flume tick` process exits non-zero; the
    // supervisor logs and proceeds (never crashes), and every subsequent tick
    // fails the same way until a human or a §5-informed retry restores it.
    let chainModule: ChainModule;
    try {
      chainModule = await this.chainLoader();
    } catch (err) {
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
    const chain = chainModule.default;
    // Foundations governor: a chain.ts `forkResolver` export overrides the
    // constructor default per tick, mirroring the `agent` override.
    const forkResolver = chainModule.forkResolver ?? this.opts.forkResolver;

    const phase = chain.phases.find((p) => awake.includes(p.name));

    if (!phase) {
      if (awake.length > 0) {
        // Axis C (§3): every awake flag names a phase the chain does not
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

    // Per-phase delegation (§4): the phase's own agent is the innermost
    // scope of the chain-level override chain.
    const agent = phase.agent ?? chainModule.agent ?? this.opts.agent;

    this.log.info(`[flume] tick → ${phase.name} (${phase.concurrency})`);

    const { result, noCommit } =
      phase.concurrency === "singleton"
        ? await this.runSingleton(phase, agent)
        : await this.runFanout(phase, agent, chain, forkResolver);

    // Sleep this phase by default; handoff re-wakes if needed.
    this.baton.sleep(phase.name);
    const handoff = phase.handoff(result);
    const allowed = handoff.filter((n) => !chain.humanOnly.includes(n));
    for (const name of allowed) this.baton.wake(name);

    return {
      hibernated: false,
      phaseName: phase.name,
      result,
      ...(noCommit ? { noCommit } : {}),
      awakeAfter: this.baton.awake(),
      summary: summarize(phase.name, result, allowed, noCommit),
    };
  }

  // ---------- singleton tick ----------

  private async runSingleton(
    phase: Phase,
    agent: Agent,
  ): Promise<{ result: TickResult; noCommit?: NoCommitMode }> {
    const cwd = this.opts.repoRoot;
    const preHead = await git.revParse(cwd);
    const pending = await this.readPending();

    const key = this.priorAttemptKey(phase);
    const prior = await this.readPriorAttempt(key);

    const ctx: TickContext = { cwd, flumeDir: this.flumeDir, pending };
    const args = phase.promptArgs?.(ctx) ?? {};
    const prompt = await renderPrompt({
      phase,
      flumeDir: this.flumeDir,
      promptFile: join(this.opts.configDir, phase.promptPath),
      cwd,
      args,
      ...(prior ? { priorAttempt: prior } : {}),
    });

    const termination = await this.invokeAgent(phase, cwd, prompt, agent);

    const postHead = await git.revParse(cwd);
    let committed = postHead !== preHead;
    const gateResults: GateResultEntry[] = [];
    let noCommit: NoCommitMode | undefined;

    if (committed) {
      const verdict = await this.runAfterCommitGates(phase, cwd, postHead);
      gateResults.push(...verdict.results);
      if (!verdict.ok) {
        // Capture the §5 record AND the §8 prose snapshot while the reverted
        // commit is still reachable, then drop it. The next tick is a fresh
        // process — these disk artifacts are the only carry. The snapshot is
        // what keeps a reverted *plan* tick's state.md / open-questions.md
        // findings recoverable without session logs (§8): the `git reset
        // --hard` below would otherwise destroy them, leaving hand-recovery
        // from `.flume/sessions/` the only path (the `5f4b583` →
        // hand-reconstructed-in-`9432489` incident).
        const record = await this.buildPriorAttempt(
          "afterCommit",
          verdict.failure!,
          cwd,
          postHead,
        );
        await this.snapshotRevertedFiles(cwd, postHead, key);
        await git.dropLastCommit(cwd);
        committed = false;
        noCommit = "gate-revert";
        await this.writePriorAttempt(key, record);
        this.log.warn(
          `[flume] ${phase.name} commit reverted: ${verdict.failure?.message}`,
        );
      }
    }

    if (committed) {
      // A clean ship clears the slot so the next tick starts with no stale
      // prior-attempt signal.
      await this.clearPriorAttempt(key);
    } else if (!noCommit) {
      // No commit and no gate ran: classify the agent's own termination
      // (§6). A clean exit that produced nothing is a voluntary-bail (the
      // agent refused a constraint and named it in its final message); any
      // process failure is a platform-preempt (not a defect in the work).
      noCommit = await this.classifyNoCommit(key, termination);
      this.log.warn(`[flume] ${phase.name}: ${noCommit} (no commit)`);
    }

    return {
      result: {
        phaseName: phase.name,
        committed,
        ...(committed ? { commitSha: postHead } : {}),
        gateResults,
        pendingAfter: await this.readPending(),
        shippedTags: [],
        revertedTags: [],
      },
      ...(noCommit ? { noCommit } : {}),
    };
  }

  // ---------- fanout tick ----------

  private async runFanout(
    phase: Phase,
    agent: Agent,
    chain: Chain,
    forkResolver?: (repoRoot: string) => (slug: string) => boolean,
  ): Promise<{ result: TickResult; noCommit?: NoCommitMode }> {
    const repoRoot = this.opts.repoRoot;
    const preHead = await git.revParse(repoRoot);
    const pending = await this.readPending();

    // Foundations governor: resolve the per-tick fork predicate once, then let
    // it gate selection alongside `blockedBy`. Default: every fork resolved.
    const isForkResolved = forkResolver?.(repoRoot) ?? (() => true);
    const pickable = pending.filter((e) =>
      isPickable(e, pending, isForkResolved),
    );

    if (pickable.length === 0) {
      // No agent ran — not a no-commit *agent* tick, so no §6 classification.
      this.log.info(`[flume] ${phase.name}: nothing pickable`);
      return {
        result: {
          phaseName: phase.name,
          committed: false,
          gateResults: [],
          pendingAfter: pending,
          shippedTags: [],
          revertedTags: [],
        },
      };
    }

    const waveStart = Date.now();
    const batches = partitionByFileOverlap(pickable, {
      maxParallel: this.maxParallel,
    });
    const batch = batches[0]!;
    this.log.info(
      `[flume] ${phase.name}: fanout ${batch.length}/${pickable.length} pickable in batch 1/${batches.length}`,
    );

    // Recover from prior crashes / partial fanout failures: prune any
    // .git/worktrees/<slug>/ entries whose working directory has vanished.
    // Without this, half-broken metadata from one slug blocks `git worktree
    // add` for ALL subsequent slugs — git scans every worktree's metadata
    // during validation.
    await git.pruneWorktrees(repoRoot);

    // Serialize worktree creation (§4). `createWorktree` internally does
    // `git worktree remove` (stale-slug cleanup) then `git worktree add`,
    // both mutating the shared `.git/worktrees/` metadata dir — and git is
    // NOT concurrency-safe there: a sibling's `--force` remove can fail
    // another's add mid-validation. Run them one at a time, mirroring the
    // already-serialized pre-wave `pruneWorktrees` above. The per-entry
    // agent fanout below stays parallel — that is the expensive work, and
    // it does not touch `.git/worktrees/`.
    const worktrees: Array<{ path: string; branch: string }> = [];
    for (const entry of batch) {
      worktrees.push(await this.createWorktree(entry, preHead));
    }

    // Optional per-phase setup (e.g. symlink node_modules / .env so gates
    // run). The return value MAY contribute extraEnv that the dispatcher
    // layers onto the agent invocation env (e.g. per-worktree DATABASE_URL
    // from a chain that provisioned an ephemeral DB at setup time).
    const extraEnvByIndex: Array<Record<string, string> | undefined> =
      worktrees.map(() => undefined);
    if (phase.setupWorktree) {
      const setupResults = await Promise.all(
        batch.map((entry, i) =>
          phase.setupWorktree!({
            worktreePath: worktrees[i]!.path,
            repoRoot,
            entryTag: entry.tag,
          }),
        ),
      );
      for (let i = 0; i < setupResults.length; i++) {
        const r = setupResults[i];
        if (r && r.extraEnv) extraEnvByIndex[i] = r.extraEnv;
      }
    }

    // Run agent in each worktree concurrently.
    const perEntry = await Promise.all(
      batch.map((entry, i) =>
        this.runFanoutEntry(
          phase,
          entry,
          worktrees[i]!,
          agent,
          chain,
          extraEnvByIndex[i],
        ),
      ),
    );

    // Cherry-pick winners onto trunk in batch order, gating each at
    // afterMerge individually (§7b). The offending entry is the one whose
    // cherry-pick turns an afterMerge gate red — nothing else changed since
    // its pre-cherry-pick trunk — so revert *only* its commit (reset to that
    // point) and leave it pending. The N−1 clean siblings already on trunk
    // stay shipped; later siblings are evaluated against the trunk without
    // the reverted commit. No `hardResetTo(preHead)` whole-wave blast
    // radius: one flaky merge-time gate no longer kills N−1 clean commits.
    // Per-entry agent fanout (above) is unchanged — only the serial
    // post-fanout merge/gate/revert granularity changes.
    const afterMergeGates = phase.gates.filter((g) => g.when === "afterMerge");
    const shipped: PendingEntry[] = [];
    const mergeReverted: PendingEntry[] = [];
    const mergeGateResults: GateResultEntry[] = [];
    // Actual footprints of merge-failed attempts, keyed by tag. Persisted
    // onto the entry (observedFiles) so the next partition separates the
    // retry from whatever it collided with — declared `files` is a plan
    // estimate, and an agent legitimately reaches beyond it.
    const observed = new Map<string, string[]>();

    for (const r of perEntry) {
      if (!r.committed || !r.commitSha) continue;

      const preCherry = await git.revParse(repoRoot);
      try {
        await git.cherryPick(repoRoot, r.commitSha);
      } catch (err) {
        this.log.warn(
          `[flume] cherry-pick failed for ${r.entry.tag}: ${(err as Error).message}; entry stays in pending`,
        );
        try {
          observed.set(r.entry.tag, await git.showNameOnly(repoRoot, r.commitSha));
        } catch {
          // Footprint capture is best-effort; the retry just partitions on
          // declared files as before.
        }
        // Abort the in-progress cherry-pick so the working tree is clean for
        // subsequent ticks. Without this, partially-applied changes block
        // the next plan tick (which can't run `pnpm install` etc. against a
        // dirty trunk) and require manual `git restore` intervention.
        await git.cherryPickAbort(repoRoot);
        continue;
      }
      const mergedSha = await git.revParse(repoRoot);

      // Gate this entry's merged commit. The first failing afterMerge gate
      // attributes the failure to *this* entry — it is the only delta
      // between `preCherry` and `mergedSha`.
      let entryFailure:
        | { gate: string; message: string; details?: string }
        | undefined;
      for (const gate of afterMergeGates) {
        const gr = await gate.run({
          cwd: repoRoot,
          repoRoot,
          flumeDir: this.flumeDir,
          phaseName: phase.name,
          commitSha: mergedSha,
          log: (l) => this.log.info(l),
        });
        mergeGateResults.push({
          gate: gate.name,
          ok: gr.ok,
          message: gr.message,
        });
        if (!gr.ok) {
          entryFailure = {
            gate: gate.name,
            message: gr.message,
            ...(gr.details ? { details: gr.details } : {}),
          };
          break;
        }
      }

      if (entryFailure) {
        this.log.warn(
          `[flume] afterMerge gate '${entryFailure.gate}' failed for ${r.entry.tag}; reverting only that entry (clean siblings stay shipped)`,
        );
        // §5: afterMerge previously surfaced nothing to the agent — the
        // explicit anti-pattern this closes. Capture the digest while the
        // cherry-picked SHA is still reachable, then drop ONLY this entry's
        // commit (reset to the pre-cherry-pick trunk), not the wave. The
        // entry stays pending; its retry carries this prior-attempt block.
        const record = await this.buildPriorAttempt(
          "afterMerge",
          entryFailure,
          repoRoot,
          mergedSha,
        );
        await this.writePriorAttempt(
          this.priorAttemptKey(phase, r.entry),
          record,
        );
        try {
          observed.set(r.entry.tag, await git.showNameOnly(repoRoot, mergedSha));
        } catch {
          // Best-effort, as above.
        }
        await git.hardResetTo(repoRoot, preCherry);
        mergeReverted.push(r.entry);
        continue;
      }

      this.log.info(
        `[flume] cherry-picked ${r.entry.tag} → ${mergedSha.slice(0, 8)}`,
      );

      // §12: landing on trunk isn't shipping — a commit that only touches
      // phase.entryChannelPaths (a park note, no implementation) must not
      // clear the entry from pending.json. Diff against the entry's
      // *declared* files.{new,edit,retire}, not touchedPaths() — that
      // folds in observedFiles, a downstream footprint signal, not proof
      // this diff shipped real work.
      const declaredFiles = [
        ...r.entry.files.new.map((f) => f.path),
        ...r.entry.files.edit.map((f) => f.path),
        ...r.entry.files.retire,
      ];
      const mergedDiff = await git.showNameOnly(repoRoot, mergedSha);
      const touchesDeclaredFile = mergedDiff.some((p) =>
        declaredFiles.includes(p),
      );
      if (!touchesDeclaredFile) {
        this.log.warn(
          `[flume] ${r.entry.tag}: cherry-picked ${mergedSha.slice(0, 8)} touches no declared file — entry stays pending (channel-only commit)`,
        );
        continue;
      }

      shipped.push(r.entry);
    }

    // Update pending.json — remove shipped entries, record merge-failure
    // footprints — as one harness commit.
    let chorSha: string | undefined;
    if (shipped.length > 0 || observed.size > 0) {
      // Each shipped entry committed clean *and* passed its afterMerge gate
      // — clear any stale prior-attempt slot so its next plan/build cycle
      // starts with no false signal.
      for (const s of shipped) {
        await this.clearPriorAttempt(this.priorAttemptKey(phase, s));
      }
      const shippedTags = shipped.map((s) => s.tag);
      // The update can no-op (footprint already recorded, nothing shipped):
      // commitPendingUpdate then returns the pre-existing HEAD, which must
      // not be reported as this wave's commit.
      const preUpdate = await git.revParse(repoRoot);
      const updSha = await this.commitPendingUpdate(
        pending,
        shippedTags,
        observed,
      );
      if (updSha !== preUpdate) chorSha = updSha;
      this.log.info(
        shippedTags.length > 0
          ? updSha === preUpdate
            ? `[flume] shipped ${shippedTags.join(", ")}; pending updated on disk, no chore commit (dock outside repo)`
            : `[flume] ship commit ${updSha.slice(0, 8)}: ${shippedTags.join(", ")}`
          : updSha === preUpdate
            ? `[flume] footprint already recorded, no commit: ${[...observed.keys()].join(", ")}`
            : `[flume] footprint commit ${updSha.slice(0, 8)}: ${[...observed.keys()].join(", ")}`,
      );
    }

    // Cleanup worktrees. Best-effort teardown fires before git.removeWorktree
    // so chain-provisioned ephemera (per-worktree DB, scratch lease, etc.)
    // releases while the worktree path still exists. Teardown failures are
    // logged but do not block worktree removal — leaks are recoverable, a
    // stuck worktree is not. Friction harvest (§4) runs in the same
    // best-effort slot, immediately before removal — the last point the
    // worktree-local mirror is still readable.
    let cleaned = 0;
    // §7: a worktree whose directory survives even the fallback removal is
    // reported once for the whole wave, not once per worktree — a locked
    // node_modules on one entry shouldn't produce N identical log lines.
    const survivingPaths: string[] = [];
    // Serialize teardown for the same reason as setup (§4): N concurrent
    // `git worktree remove --force` calls race the shared `.git/worktrees/`
    // dir. The chain's `teardownWorktree` hook and branch deletion ride the
    // same serial loop — teardown is off the critical path, so a simple
    // sequential walk beats interleaving the git-mutating step out alone.
    for (let i = 0; i < worktrees.length; i++) {
      const wt = worktrees[i]!;
      const tag = batch[i]!.tag;
      if (phase.teardownWorktree) {
        try {
          await phase.teardownWorktree({
            worktreePath: wt.path,
            repoRoot,
            entryTag: tag,
          });
        } catch (err) {
          this.log.warn(
            `[flume] teardownWorktree failed for ${wt.path}: ${(err as Error).message}`,
          );
        }
      }
      await this.harvestFriction(chain, wt.path, tag);
      try {
        await git.removeWorktree(repoRoot, wt.path);
        cleaned++;
      } catch (err) {
        survivingPaths.push(wt.path);
      }
      await git.deleteBranch(repoRoot, wt.branch);
    }
    this.log.info(
      `[flume] ${phase.name}: cleaned ${cleaned}/${worktrees.length} worktree(s)`,
    );
    if (survivingPaths.length > 0) {
      this.log.warn(
        `[flume] ${phase.name}: ${survivingPaths.length} worktree(s) survived removal (fallback exhausted): ${survivingPaths.join(", ")}`,
      );
    }
    this.log.info(
      `[flume] ${phase.name}: wave done in ${Date.now() - waveStart}ms`,
    );

    const allGateResults = perEntry
      .flatMap((r) => r.gateResults)
      .concat(mergeGateResults);

    const committedWave = shipped.length > 0;

    // Wave-level §6 cause, only when the wave shipped nothing usable.
    // Per-entry modes are already persisted to each entry's own §5 record
    // (the durable channel §6 mandates); this is the single representative
    // label for the logger/TickOutcome. Precedence gate-revert >
    // platform-preempt > voluntary-bail: gate-revert means work was produced
    // and lost (highest signal); platform-preempt outranks voluntary-bail so
    // a rate-limited wave is not misread as the agents bailing — §6's
    // explicit "platform failures masquerade as agent failures" harm.
    let waveNoCommit: NoCommitMode | undefined;
    if (!committedWave) {
      const modes = new Set<NoCommitMode>(
        perEntry.flatMap((r) => (r.noCommit ? [r.noCommit] : [])),
      );
      // Per-entry afterMerge isolation (§7b) wrote a gate-revert §5 record
      // for each merge-reverted entry; reflect that in the wave-level cause.
      if (mergeReverted.length > 0) modes.add("gate-revert");
      waveNoCommit = modes.has("gate-revert")
        ? "gate-revert"
        : modes.has("platform-preempt")
          ? "platform-preempt"
          : modes.has("voluntary-bail")
            ? "voluntary-bail"
            : undefined;
    }

    return {
      result: {
        phaseName: phase.name,
        committed: committedWave,
        ...(chorSha ? { commitSha: chorSha } : {}),
        gateResults: allGateResults,
        pendingAfter: await this.readPending(),
        shippedTags: shipped.map((s) => s.tag),
        revertedTags: mergeReverted.map((e) => e.tag),
      },
      ...(waveNoCommit ? { noCommit: waveNoCommit } : {}),
    };
  }

  // ---------- per-entry fanout ----------

  private async runFanoutEntry(
    phase: Phase,
    entry: PendingEntry,
    wt: { path: string; branch: string },
    agent: Agent,
    chain: Chain,
    extraEnv?: Record<string, string>,
  ): Promise<{
    entry: PendingEntry;
    committed: boolean;
    commitSha?: string;
    gateResults: GateResultEntry[];
    /** §6 mode when this entry produced no usable commit; absent when it shipped. */
    noCommit?: NoCommitMode;
  }> {
    // The prior-attempt record lives at the repo root (not this fresh
    // worktree), keyed by the entry tag — so a reverted attempt's record
    // survives into the next tick's brand-new worktree.
    const key = this.priorAttemptKey(phase, entry);
    const prior = await this.readPriorAttempt(key);

    const ctx: TickContext = {
      cwd: wt.path,
      flumeDir: this.flumeDir,
      assignedEntry: entry,
    };
    const args = phase.promptArgs?.(ctx) ?? {};
    const prompt = await renderPrompt({
      phase,
      flumeDir: this.flumeDir,
      promptFile: join(this.opts.configDir, phase.promptPath),
      cwd: wt.path,
      args,
      assignedEntry: entry,
      ...(prior ? { priorAttempt: prior } : {}),
    });

    const preHead = await git.revParse(wt.path);
    const termination = await this.invokeAgent(
      phase,
      wt.path,
      prompt,
      agent,
      extraEnv,
    );
    const postHead = await git.revParse(wt.path);
    const committed = postHead !== preHead;

    const gateResults: GateResultEntry[] = [];
    if (!committed) {
      // No commit, no gate: classify per-entry and persist the matching §5
      // record (the durable per-entry channel §6 names — corpus-config-example
      // bailed at the same writablePaths wall five sessions running; that
      // must be legible without reading session logs).
      const mode = await this.classifyNoCommit(key, termination);
      this.log.warn(`[flume] ${entry.tag}: ${mode} (no commit)`);
      return { entry, committed: false, gateResults, noCommit: mode };
    }

    const verdict = await this.runAfterCommitGates(
      phase,
      wt.path,
      postHead,
      entry,
    );
    gateResults.push(...verdict.results);
    if (!verdict.ok) {
      const record = await this.buildPriorAttempt(
        "afterCommit",
        verdict.failure!,
        wt.path,
        postHead,
      );
      await this.writeRevertNote(
        chain,
        wt.path,
        postHead,
        entry,
        verdict.failure!,
      );
      await git.dropLastCommit(wt.path);
      await this.writePriorAttempt(key, record);
      this.log.warn(
        `[flume] ${entry.tag}: commit reverted (${verdict.failure?.message})`,
      );
      return { entry, committed: false, gateResults, noCommit: "gate-revert" };
    }

    return {
      entry,
      committed: true,
      commitSha: postHead,
      gateResults,
    };
  }

  // ---------- helpers ----------

  private async invokeAgent(
    phase: Phase,
    cwd: string,
    prompt: string,
    agent: Agent,
    extraEnv?: Record<string, string>,
  ): Promise<AgentTermination> {
    try {
      const result = await agent.invoke({
        cwd,
        prompt,
        ...(this.tickTimeoutMs !== undefined
          ? { timeoutMs: this.tickTimeoutMs }
          : {}),
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
        ...(extraEnv ? { extraEnv } : {}),
      });
      if (result.exitCode !== 0) {
        // A non-zero exit is a process failure, not a deliberate bail: crash,
        // OOM/SIGKILL, auth, or rate-limit surfaced as a non-zero code. §6
        // platform-preempt — not a defect in the work.
        const failureClass = `agent process exited with code ${result.exitCode} (non-work failure: crash, kill, auth, or rate-limit surfaced as a non-zero exit)`;
        this.log.warn(`[flume] ${phase.name}: ${failureClass}`);
        return { kind: "process-failure", failureClass };
      }
      // Clean exit. `result.stdout` is the full captured transcript; the
      // agent's final message — where a writablePaths/Rule-0/spec bail names
      // the constraint it refused — lives at its tail.
      return { kind: "clean", stdout: result.stdout };
    } catch (err) {
      // Swallow abort/timeout/spawn errors so a single bad invocation doesn't
      // tear down the loop. The post-invocation `git rev-parse` still runs,
      // so any commit the agent managed to make before aborting is honored;
      // otherwise the phase falls through with `committed: false`. Either way
      // this is a §6 platform-preempt — not a defect in the work.
      const e = err as Error & { name?: string; code?: string };
      const failureClass =
        e.name === "AbortError" || e.code === "ABORT_ERR"
          ? "agent process aborted (per-tick timeout or dispatcher signal)"
          : `agent process error before exit: ${e.message}`;
      this.log.warn(`[flume] ${phase.name}: ${failureClass}`);
      return { kind: "process-failure", failureClass };
    }
  }

  private async runAfterCommitGates(
    phase: Phase,
    cwd: string,
    commitSha: string,
    assignedEntry?: PendingEntry,
  ): Promise<{
    ok: boolean;
    /** First failing gate, structured so callers can persist a §5 record. */
    failure?: { gate: string; message: string; details?: string };
    results: GateResultEntry[];
  }> {
    // Entry-scoped write guard (§5): a fanout tick's allowance narrows to the
    // assigned entry's declared files ∪ the phase's channel globs, with the
    // phase-wide globs as the outer ceiling. Singleton ticks (no entry) keep
    // phase-wide scope. `observedFiles` is deliberately excluded — it feeds
    // the partition, not the write allowance.
    const gates: Gate[] = [
      ...phase.gates.filter((g) => g.when === "afterCommit"),
      writablePathsGate(
        phase.writablePaths,
        assignedEntry
          ? {
              entryPaths: [
                ...assignedEntry.files.new.map((f) => f.path),
                ...assignedEntry.files.edit.map((f) => f.path),
                ...assignedEntry.files.retire,
              ],
              channelPaths: phase.entryChannelPaths ?? [],
            }
          : undefined,
      ),
    ];
    const results: GateResultEntry[] = [];
    for (const gate of gates) {
      const r: GateResult = await gate.run({
        cwd,
        repoRoot: cwd,
        flumeDir: this.flumeDir,
        phaseName: phase.name,
        commitSha,
        log: (l) => this.log.info(l),
      });
      results.push({ gate: gate.name, ok: r.ok, message: r.message });
      if (!r.ok) {
        if (r.details) this.log.warn(r.details);
        return {
          ok: false,
          failure: {
            gate: gate.name,
            message: r.message,
            ...(r.details ? { details: r.details } : {}),
          },
          results,
        };
      }
    }
    return { ok: true, results };
  }

  /**
   * §4 (RELEASE-v0.6.2): before a fanout worktree is torn down, move every
   * file its declared friction channel holds into the primary friction dir,
   * prefixed `<tag>--` for provenance and collision-freedom. Harvest is
   * harness code crossing the worktree boundary (the sessions precedent),
   * not an agent write — worktree agents still only ever write under their
   * own `$PWD`.
   *
   * Undeclared `chain.friction` — no-op. A relocated state root (`flumeDir`
   * outside the repo tree) has no worktree-local mirror to harvest from —
   * also a no-op, per §4's stated scope. Any failure here (missing dir,
   * unreadable file, locked handle) is logged and swallowed: harvest must
   * never abort the wave, and whatever it can't move is left for §7's
   * removal-fallback sweep to surface.
   */
  private async harvestFriction(
    chain: Chain,
    worktreePath: string,
    tag: string,
  ): Promise<void> {
    if (chain.friction === undefined) return;
    const stateRootRel = relative(this.opts.repoRoot, this.flumeDir);
    const relocated =
      stateRootRel === ".." ||
      stateRootRel.startsWith(`..${sep}`) ||
      isAbsolute(stateRootRel);
    if (relocated) return;

    const mirrorDir = join(worktreePath, stateRootRel, chain.friction);
    let entries: Dirent[];
    try {
      entries = await readdir(mirrorDir, { withFileTypes: true });
    } catch (err) {
      // Absent dir (no friction written this tick) is expected and silent.
      // Anything else — unreadable dir, e.g. permissions — is §4's
      // log-and-continue failure class, not a silent no-op.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log.warn(
          `[flume] friction harvest: could not read ${mirrorDir}: ${(err as Error).message}`,
        );
      }
      return;
    }
    const files = entries.filter((e) => e.isFile());
    if (files.length === 0) return;

    const primaryDir = join(this.flumeDir, chain.friction);
    try {
      await mkdir(primaryDir, { recursive: true });
    } catch (err) {
      this.log.warn(
        `[flume] friction harvest: could not create ${primaryDir}: ${(err as Error).message}`,
      );
      return;
    }

    for (const file of files) {
      const src = join(mirrorDir, file.name);
      const dest = join(primaryDir, `${tag}--${file.name}`);
      try {
        await rename(src, dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          // Worktree relocated onto a different volume (FLUME_WORKTREES_DIR)
          // — rename can't cross devices; copy then drop the source instead.
          try {
            await copyFile(src, dest);
            await rm(src, { force: true });
            continue;
          } catch (copyErr) {
            this.log.warn(
              `[flume] friction harvest: failed to move ${src}: ${(copyErr as Error).message}`,
            );
            continue;
          }
        }
        this.log.warn(
          `[flume] friction harvest: failed to move ${src}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async createWorktree(
    entry: PendingEntry,
    fromRef: string,
  ): Promise<{ path: string; branch: string }> {
    const slug = slugify(entry.tag);
    // Job-scoped branch namespace (v0.5 §4): with a namespace, identical tag
    // slugs across jobs land on disjoint branches; without one, the legacy
    // repo-global name stands (bare `.flume` harnesses unchanged).
    const branch = this.opts.namespace
      ? `flume/${this.opts.namespace}/${slug}`
      : `flume/${slug}`;
    // FLUME_WORKTREES_DIR: ephemeral worktrees relocate OUTSIDE the repo so an
    // agent's pwd never contains the root checkout's path as a prefix (the
    // observed stray-write vector: a model that sees `<root>/.flume/worktrees/x`
    // derives `<root>` and operates there). Default tracks the state root
    // (§16), which is itself relocatable via FLUME_DIR.
    const wtBase = process.env.FLUME_WORKTREES_DIR
      ? resolve(process.env.FLUME_WORKTREES_DIR)
      : join(this.flumeDir, "worktrees");
    // The path mirrors the branch namespacing: under a shared
    // FLUME_WORKTREES_DIR two jobs with identical tag slugs would otherwise
    // collide on <base>/<slug>, and the stale-cleanup below would rm the
    // OTHER job's live worktree. Namespaced unconditionally when set — the
    // redundant level under a default per-job base is harmless.
    const path = this.opts.namespace
      ? join(wtBase, this.opts.namespace, slug)
      : join(wtBase, slug);
    if (existsSync(path)) {
      // Stale from a prior crashed run; clean up.
      try {
        await git.removeWorktree(this.opts.repoRoot, path);
      } catch {
        await rm(path, { recursive: true, force: true });
      }
    }
    await mkdir(dirname(path), { recursive: true });
    await git.addWorktree({
      repoRoot: this.opts.repoRoot,
      path,
      branch,
      fromRef,
    });
    return { path, branch };
  }

  // ---------- prior-attempt persistence (§5) ----------

  /**
   * Key under which a phase/entry's prior-attempt record lives: the entry
   * tag slug for fanout, the phase name for singleton. A retry is scheduled
   * "for that same entry (fanout) or phase (singleton)" — the key mirrors
   * exactly that scope so the next tick reads its own predecessor.
   */
  private priorAttemptKey(phase: Phase, entry?: PendingEntry): string {
    return entry ? slugify(entry.tag) : phase.name;
  }

  private priorAttemptPath(key: string): string {
    return join(this.flumeDir, PRIOR_ATTEMPTS_SUBDIR, `${key}.json`);
  }

  /**
   * Read a persisted prior-attempt record, if any. Corrupt, or carrying an
   * unrecognized `mode` discriminant → treated as absent: the renderer is
   * exhaustive over the three known modes and must never be fed an unknown
   * shape (and a stale slot should never become a false signal).
   */
  private async readPriorAttempt(
    key: string,
  ): Promise<PriorAttempt | undefined> {
    const p = this.priorAttemptPath(key);
    if (!existsSync(p)) return undefined;
    try {
      const rec = JSON.parse(await readFile(p, "utf8")) as { mode?: unknown };
      if (
        rec &&
        (rec.mode === "gate-revert" ||
          rec.mode === "voluntary-bail" ||
          rec.mode === "platform-preempt")
      ) {
        return rec as PriorAttempt;
      }
      return undefined;
    } catch {
      // A garbled record must not crash the tick — degrade to "no prior".
      return undefined;
    }
  }

  private async writePriorAttempt(
    key: string,
    rec: PriorAttempt,
  ): Promise<void> {
    const p = this.priorAttemptPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(rec, null, 2) + "\n", "utf8");
  }

  /**
   * Clear a prior-attempt record once a later attempt commits clean — both
   * the §5 JSON and the §8 reverted-prose snapshot, so a clean ship leaves no
   * stale recovery artifact (the same no-false-signal invariant the §5 slot
   * already holds, extended to the prose snapshot).
   */
  private async clearPriorAttempt(key: string): Promise<void> {
    await rm(this.priorAttemptPath(key), { force: true });
    await rm(this.revertedSnapshotDir(key), { recursive: true, force: true });
  }

  // ---------- reverted-prose durability (§8) ----------

  /**
   * Durable, gitignored snapshot dir for a gate-reverted commit's files.
   * Sibling to the §5 JSON under `<flumeDir>/prior-attempts/` (NOT the
   * per-entry worktree) so it outlives both `git reset --hard` and a fanout
   * worktree teardown — the same durability the §5 record relies on.
   */
  private revertedSnapshotDir(key: string): string {
    return join(this.flumeDir, PRIOR_ATTEMPTS_SUBDIR, `${key}.reverted`);
  }

  /**
   * Snapshot every non-deleted file the reverted commit touched, verbatim,
   * into the durable snapshot dir before the hard reset destroys it (§8).
   *
   * A gate-reverted plan tick otherwise loses its state.md /
   * open-questions.md prose to `git reset --hard`, recoverable only by a
   * human reading `.flume/sessions/` logs. The snapshot is post-image content
   * under a mirror of the repo path, so recovery is "open the file" — not
   * "read a diff", not "grep a session log". `diffStat` (the §5 digest) is
   * `git show --stat`: filenames and counts, never content — it cannot
   * recover findings, which is why §8 needs this distinct artifact.
   *
   * Generic by construction: it snapshots whatever the reverted commit
   * changed (for plan that is the prose plus the schema-failing
   * pending.json), so the dispatcher needs no chain-specific notion of which
   * artifact is "prose" vs "machine-checkable". Must run while `sha` is still
   * reachable (before the drop). Best-effort: §8 mandates the property, not a
   * guarantee under a broken git — a snapshot failure must never block or
   * fail the revert.
   */
  private async snapshotRevertedFiles(
    cwd: string,
    sha: string,
    key: string,
  ): Promise<void> {
    const dir = this.revertedSnapshotDir(key);
    try {
      // The artifact tracks the *latest* reverted attempt only — drop any
      // stale snapshot from an earlier revert under this key first.
      await rm(dir, { recursive: true, force: true });
      const { stdout } = await execFileP(
        "git",
        [
          "show",
          "--name-only",
          "--diff-filter=d",
          "--format=",
          "--no-color",
          sha,
        ],
        { cwd, maxBuffer: 16 * 1024 * 1024 },
      );
      const files = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const rel of files) {
        const { stdout: content } = await execFileP(
          "git",
          ["show", `${sha}:${rel}`],
          { cwd, maxBuffer: 16 * 1024 * 1024 },
        );
        const dest = join(dir, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, content, "utf8");
      }
    } catch {
      // Recovery is best-effort by spec; never block or fail the revert path.
    }
  }

  /**
   * Bounded `git show --stat` of the reverted commit — the §5 digest so the
   * retry does not blindly reconstruct. Must be called while `sha` is still
   * reachable (before the hard reset / commit drop). Best-effort: a failure
   * here must not block the revert path.
   */
  private async capturedDiffStat(cwd: string, sha: string): Promise<string> {
    try {
      const { stdout } = await execFileP(
        "git",
        ["show", "--stat", "--oneline", "--no-color", sha],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      return bound(stdout.trimEnd(), MAX_PRIOR_DIFFSTAT);
    } catch {
      return "(diff stat unavailable)";
    }
  }

  /**
   * Subject + body of a commit, read while `sha` is still reachable (before
   * the hard reset / commit drop). Best-effort: a failure here must not
   * block the revert path.
   */
  private async capturedCommitMessage(
    cwd: string,
    sha: string,
  ): Promise<{ subject: string; body: string }> {
    try {
      const { stdout: subject } = await execFileP(
        "git",
        ["show", "-s", "--format=%s", "--no-color", sha],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      const { stdout: body } = await execFileP(
        "git",
        ["show", "-s", "--format=%b", "--no-color", sha],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      return { subject: subject.trim(), body: body.trim() };
    } catch {
      return { subject: "(commit message unavailable)", body: "" };
    }
  }

  /**
   * §5 (RELEASE-v0.6.2): when an afterCommit gate reverts a fanout entry's
   * commit and `Chain.friction` is declared, write the operator's copy of
   * the verdict — the gate name/message/details plus the reverted commit's
   * subject+body — to `<friction>/<ISO-timestamp>--<tag>--reverted.md`
   * before `git.dropLastCommit` discards the evidence. Written straight to
   * the primary friction dir (harness code reaching into `flumeDir`, the
   * sessions/harvest precedent) rather than the worktree-local mirror —
   * this runs mid-wave, well before that worktree's own teardown harvest.
   *
   * Undeclared `chain.friction` is a no-op, per §2. Best-effort: a
   * note-write failure must never block the revert it is documenting.
   */
  private async writeRevertNote(
    chain: Chain,
    cwd: string,
    sha: string,
    entry: PendingEntry,
    failure: { gate: string; message: string; details?: string },
  ): Promise<void> {
    if (chain.friction === undefined) return;
    try {
      const { subject, body } = await this.capturedCommitMessage(cwd, sha);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const primaryDir = join(this.flumeDir, chain.friction);
      await mkdir(primaryDir, { recursive: true });
      const lines = [
        `# Gate revert: ${failure.gate}`,
        "",
        failure.message,
        ...(failure.details ? ["", "## Details", "", failure.details] : []),
        "",
        "## Reverted commit",
        "",
        subject,
        ...(body ? ["", body] : []),
        "",
      ];
      await writeFile(
        join(primaryDir, `${stamp}--${entry.tag}--reverted.md`),
        lines.join("\n"),
        "utf8",
      );
    } catch (err) {
      this.log.warn(
        `[flume] ${entry.tag}: revert note write failed: ${(err as Error).message}`,
      );
    }
  }

  private async buildPriorAttempt(
    when: GateRevertAttempt["when"],
    failure: { gate: string; message: string; details?: string },
    diffCwd: string,
    sha: string,
  ): Promise<GateRevertAttempt> {
    const diffStat = await this.capturedDiffStat(diffCwd, sha);
    return {
      mode: "gate-revert",
      when,
      gate: failure.gate,
      message: failure.message,
      ...(failure.details
        ? { details: bound(failure.details, MAX_PRIOR_DETAILS) }
        : {}),
      diffStat,
    };
  }

  /**
   * Classify a no-commit-no-gate tick (§6) and persist the matching §5
   * record so the retry's prompt carries it. A clean agent exit that
   * produced nothing is a **voluntary-bail** — the constraint it refused is
   * its final message (the build/plan prompts instruct the agent to name the
   * writablePaths/Rule-0/spec gap there); a **platform-preempt** otherwise —
   * the non-work failure class, explicitly not a defect in the work. Returns
   * the mode for `TickOutcome` / the logger record.
   */
  private async classifyNoCommit(
    key: string,
    termination: AgentTermination,
  ): Promise<NoCommitMode> {
    if (termination.kind === "clean") {
      await this.writePriorAttempt(key, buildVoluntaryBail(termination.stdout));
      return "voluntary-bail";
    }
    await this.writePriorAttempt(
      key,
      buildPlatformPreempt(termination.failureClass),
    );
    return "platform-preempt";
  }

  private async readPending(): Promise<PendingEntry[]> {
    if (!existsSync(this.pendingPath)) return [];
    const raw = await readFile(this.pendingPath, "utf8");
    const r = parsePending(raw);
    if (!r.ok) {
      this.log.warn(
        `[flume] pending.json failed to parse (${r.errors.length} errors); treating as empty`,
      );
      return [];
    }
    return r.entries;
  }

  private async commitPendingUpdate(
    before: PendingEntry[],
    shippedTags: string[],
    observed: ReadonlyMap<string, string[]> = new Map(),
  ): Promise<string> {
    const shipped = new Set(shippedTags);
    // A blockedBy gate naming a tag this wave shipped is resolved HERE,
    // mechanically: the dispatcher just merged and gated that tag, so
    // "did the blocker land" needs no plan tick — the next wave forms
    // without a plan interim. Judgment gates (parked) stay plan's.
    const after = before
      .filter((e) => !shipped.has(e.tag))
      .map((e) =>
        e.gate.kind === "blockedBy" && shipped.has(e.gate.tag)
          ? { ...e, gate: { kind: "open" as const } }
          : e,
      )
      .map((e) => {
        const obs = observed.get(e.tag);
        if (!obs || obs.length === 0) return e;
        const merged = [...new Set([...(e.observedFiles ?? []), ...obs])];
        return { ...e, observedFiles: merged };
      });
    const serialized = JSON.stringify(after, null, 2) + "\n";
    // A footprint-only update can be a no-op (same collision, same paths,
    // second time around) — committing an unchanged file fails, so skip.
    const existing = await readFile(this.pendingPath, "utf8").catch(() => "");
    if (serialized === existing) {
      return git.revParse(this.opts.repoRoot);
    }
    await mkdir(dirname(this.pendingPath), { recursive: true });
    await writeFile(this.pendingPath, serialized, "utf8");
    // A relocated flumeDir puts pendingPath outside the repo, where staging
    // it would fatal — after the entries already merged. An out-of-tree dock
    // is invisible to git by construction, so no chore commit is wanted: the
    // disk write alone carries the auto-unblock and observedFiles forward.
    const rel = relative(this.opts.repoRoot, this.pendingPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return git.revParse(this.opts.repoRoot);
    }
    // Scoped to pending.json — `git add -A` would sweep up untracked worktree
    // metadata and unrelated user changes into the harness's chore commit.
    return git.commitPaths({
      cwd: this.opts.repoRoot,
      message:
        shippedTags.length > 0
          ? `chore(flume): ship ${shippedTags.join(", ")}`
          : `chore(flume): record merge-failure footprints for ${[...observed.keys()].join(", ")}`,
      paths: [this.pendingPath],
    });
  }
}

// ---------- loop supervisor (§2) ----------

/** Options for {@link superviseLoop}. */
export interface SuperviseLoopOptions {
  /** Repo root; child ticks spawn with this as their cwd. */
  repoRoot: string;
  /**
   * Mutable-state root the supervisor reads baton state from between child
   * ticks. Must match the `flumeDir` the children write to (the CLI carries it
   * across the process boundary via the `FLUME_DIR` env var, which children
   * inherit). Defaults to `<repoRoot>/.flume`.
   */
  flumeDir?: string;
  /**
   * Chain+prompts dir the supervisor loads the chain from for the loop-end
   * friction summary (§6, v0.6.2) — repo-resident, never a job dir (mirrors
   * every other `configDir` default). Defaults to `<repoRoot>/.flume`.
   */
  configDir?: string;
  /** Max child ticks before stopping (the `--max N` cap). Default 50. */
  maxTicks?: number;
  log?: Logger;
  /**
   * Run one `flume tick` as a fresh child process; resolves with its exit
   * code when it exits. Defaults to re-execing the running flume entrypoint
   * (mirrors `process.execArgv`/`argv[1]`, so it works whether launched from
   * the built `dist/cli.js` or `tsx src/cli.ts`). Injected by tests — the
   * stubbed-spawn seam.
   */
  runTick?: () => Promise<{ exitCode: number | null }>;
}

/** Outcome of a supervised loop: how many child ticks ran and why it stopped. */
export interface SuperviseResult {
  ticks: number;
  hibernated: boolean;
  /**
   * Set when the loop fail-fasted on a child exiting
   * {@link EX_TERMINAL_MISCONFIG} (§3). `phases` are the orphaned awake
   * flags read off disk for the summary — the stop *decision* is the exit
   * code alone.
   */
  terminal?: TerminalMisconfiguration;
}

/**
 * `flume loop` supervisor (§2). Spawns exactly one `flume tick` child process
 * per iteration, carrying no in-memory chain or phase state across them — the
 * only correct re-resolution mechanism (Node's ESM registry is non-evictable,
 * so an in-process loop is pinned to chain.ts's first evaluation; see
 * `loadChainModule`). Between children it reads the on-disk baton
 * (disk-is-truth): no awake flags ⇒ hibernation ⇒ stop. A child that exits
 * non-zero (e.g. an ungated broken chain.ts: §3) is logged and the loop
 * proceeds — the supervisor never crashes — except
 * {@link EX_TERMINAL_MISCONFIG} (Axis-C terminal misconfiguration), which
 * stops the loop immediately: the orphaned awake flags that produced it
 * defeat the hibernation check, so proceeding would hot-spin to `--max`
 * while masquerading each iteration as routine. Bounded by `maxTicks` (the
 * `--max N` cap); observable `--max`/hibernation behavior is unchanged from
 * the prior in-process loop.
 */
export async function superviseLoop(
  opts: SuperviseLoopOptions,
): Promise<SuperviseResult> {
  const log = opts.log ?? consoleLogger;
  const maxTicks = opts.maxTicks ?? 50;
  const flumeDir = opts.flumeDir ?? join(opts.repoRoot, ".flume");
  const configDir = opts.configDir ?? join(opts.repoRoot, ".flume");
  const baton = new Baton(flumeDir);
  const runTick = opts.runTick ?? defaultTickRunner(opts.repoRoot);

  // §6 (v0.6.2): best-effort — a missing or broken chain must never fail
  // the loop-end summary, only silently withhold the friction line.
  const logFrictionSummary = async (): Promise<void> => {
    try {
      const { default: chain } = await diskChainLoader(configDir)();
      const line = await frictionCountLine(flumeDir, chain);
      if (line) log.info(`[flume] ${line}`);
    } catch {
      // no chain, or a chain that fails to load — nothing to summarize
    }
  };

  let ticks = 0;
  for (let i = 0; i < maxTicks; i++) {
    const { exitCode } = await runTick();
    ticks++;
    if (exitCode === EX_TERMINAL_MISCONFIG) {
      // Axis-C fail-fast (§3): the child classified a terminal
      // misconfiguration (orphaned awake flags). The decision comes from the
      // exit signal alone — the orphaned flags definitionally defeat
      // `baton.hibernating()`, so it is never consulted here. The flags are
      // still on disk (the child leaves them); read them only to *name* the
      // orphans in the summary.
      const phases = baton.awake();
      log.error(
        `[flume] tick exited ${exitCode} (terminal misconfiguration): ` +
          `orphaned awake flags name unknown phases: ` +
          `${phases.length > 0 ? phases.join(", ") : "(none on disk)"}; ` +
          `stopping after ${ticks} tick(s). Inspect, then ` +
          `\`flume sleep <phase>\` or fix the chain.`,
      );
      return {
        ticks,
        hibernated: false,
        terminal: { kind: "orphaned-awake", phases },
      };
    }
    if (exitCode !== 0) {
      log.warn(
        `[flume] tick process exited with code ${exitCode}; ` +
          `supervisor continuing (next tick is a fresh process)`,
      );
    }
    // Disk is truth: the child tick slept its phase and woke successors (or
    // didn't). No awake flags ⇒ hibernation. A failed tick does no baton
    // work, so an unguarded broken chain.ts keeps a phase awake and fails
    // loudly every iteration until restored or --max is hit.
    if (baton.hibernating()) {
      log.info(`[flume] hibernating after ${ticks} tick(s)`);
      await logFrictionSummary();
      return { ticks, hibernated: true };
    }
  }
  log.info(`[flume] reached --max ${maxTicks}; stopping`);
  await logFrictionSummary();
  return { ticks, hibernated: false };
}

/**
 * Default {@link SuperviseLoopOptions.runTick}: spawn `flume tick` as a fresh
 * process mirroring however the supervisor itself was launched. `execArgv`
 * carries node flags (e.g. `--import tsx` when run from source); `argv[1]` is
 * the cli entrypoint (`dist/cli.js` built, `src/cli.ts` from source).
 */
function defaultTickRunner(
  repoRoot: string,
): () => Promise<{ exitCode: number | null }> {
  return () =>
    new Promise((resolveExit) => {
      const child = spawn(
        process.execPath,
        [...process.execArgv, process.argv[1]!, "tick"],
        { cwd: repoRoot, stdio: "inherit" },
      );
      child.on("exit", (code) => resolveExit({ exitCode: code }));
      child.on("error", (err) => {
        consoleLogger.error(
          `[flume] failed to spawn 'flume tick': ${(err as Error).message}`,
        );
        resolveExit({ exitCode: 1 });
      });
    });
}

// ---------- module-private utilities ----------

function summarize(
  phaseName: string,
  result: TickResult,
  awaking: string[],
  noCommit?: NoCommitMode,
): string {
  const parts: string[] = [phaseName];
  if (result.committed) {
    if (result.shippedTags.length > 0) {
      parts.push(`shipped ${result.shippedTags.join(", ")}`);
    } else if (result.commitSha) {
      parts.push(`committed ${result.commitSha.slice(0, 8)}`);
    }
  } else {
    // The §6 mode in the one-liner is the logger record that lets a
    // voluntary-bail loop be told from a platform-preempt run without
    // reading session logs.
    parts.push(noCommit ? `no commit (${noCommit})` : "no commit");
  }
  if (awaking.length > 0) parts.push(`→ ${awaking.join(",")}`);
  else parts.push(`→ hibernate`);
  return parts.join(" ");
}

/**
 * Build the §6 voluntary-bail record: the agent exited cleanly without
 * committing. The constraint it refused is its final message, bounded — the
 * build/plan prompts instruct it to name the writablePaths/Rule-0/spec gap
 * there. {@link finalAgentMessage} lifts that message out of a stream-json
 * transcript before bounding, so the refused constraint reaches the retry
 * legibly rather than as escaped-JSON/cost-metadata noise.
 */
function buildVoluntaryBail(stdout: string): VoluntaryBailAttempt {
  const message = finalAgentMessage(stdout);
  return {
    mode: "voluntary-bail",
    constraint:
      message.length > 0
        ? message
        : "(agent exited cleanly without committing and produced no final message naming a constraint)",
  };
}

/**
 * The agent's final message, bounded for the §5 voluntary-bail block.
 *
 * The dogfood `.flume/chain.ts` runs the agent under
 * `withTerminalRenderer(withSessionCapture(claudeCode({ outputFormat:
 * "stream-json" })))`. Those decorators pass stdout through raw, so
 * `AgentResult.stdout` is the stream-json NDJSON transcript, not prose —
 * tailing it raw forwards escaped-JSON assistant/result events plus
 * cost/usage metadata, the exact §6 noise this block is meant to replace
 * with the refused constraint. When stdout parses as stream-json, lift the
 * agent's final message out of the transcript: the terminal `result` event's
 * `result` text (Claude Code puts the final assistant message there
 * verbatim), else the last `assistant` turn's concatenated text blocks. A
 * plain-text agent (`claudeCode({ outputFormat: "text" })`) emits no
 * stream-json events — its stdout already IS the final message, returned
 * unchanged. Either way the result is `tailBound` to `MAX_PRIOR_NOCOMMIT`:
 * a bail names its constraint at the tail of its closing message.
 */
function finalAgentMessage(stdout: string): string {
  let sawStreamJson = false;
  let resultText: string | undefined;
  let lastAssistantText: string | undefined;

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // a non-JSON line is not a stream-json event
    }
    if (!evt || typeof evt !== "object") continue;
    const e = evt as Record<string, unknown>;
    if (typeof e.type !== "string") continue;
    sawStreamJson = true;
    if (e.type === "result") {
      if (typeof e.result === "string" && e.result.trim().length > 0) {
        resultText = e.result.trim();
      }
    } else if (e.type === "assistant") {
      const text = assistantTurnText(e);
      if (text.length > 0) lastAssistantText = text;
    }
  }

  if (!sawStreamJson) {
    // Plain-text agent: stdout already IS the final message.
    return tailBound(stdout.trim(), MAX_PRIOR_NOCOMMIT);
  }
  return tailBound(resultText ?? lastAssistantText ?? "", MAX_PRIOR_NOCOMMIT);
}

/**
 * Concatenated `text` blocks of one stream-json `assistant` event;
 * `tool_use`/`thinking` blocks are dropped (they are not the agent's prose).
 */
function assistantTurnText(e: Record<string, unknown>): string {
  const msg = e.message as { content?: unknown } | undefined;
  const content = Array.isArray(msg?.content) ? msg!.content : [];
  const parts: string[] = [];
  for (const c of content) {
    if (
      c &&
      typeof c === "object" &&
      (c as Record<string, unknown>).type === "text" &&
      typeof (c as Record<string, unknown>).text === "string"
    ) {
      parts.push(((c as Record<string, unknown>).text as string).trim());
    }
  }
  return parts.join("\n\n").trim();
}

/** Build the §6 platform-preempt record from the non-work failure class. */
function buildPlatformPreempt(failureClass: string): PlatformPreemptAttempt {
  return {
    mode: "platform-preempt",
    failureClass: bound(failureClass, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Pickability in the fanout context. The dispatcher's model: a dep is
 * satisfied iff it is no longer in pending (we remove entries on ship).
 * `requiresDockerHost` is opt-in and deferred to v1.
 *
 * The foundations governor (§v0.3) runs first: an entry whose `dependsOnForks`
 * contains any unresolved slug is not pickable, regardless of gate kind.
 * `isForkResolved` defaults to always-resolved so the check is a no-op when no
 * resolver is wired or no entry declares a fork dependency.
 */
function isPickable(
  entry: PendingEntry,
  pending: readonly PendingEntry[],
  isForkResolved: (slug: string) => boolean = () => true,
): boolean {
  if (!entry.dependsOnForks.every(isForkResolved)) return false;
  switch (entry.gate.kind) {
    case "open":
      return true;
    case "blockedBy": {
      // Narrow into a local so the closure doesn't lose the discriminator.
      const depTag = entry.gate.tag;
      return !pending.some((e) => e.tag === depTag);
    }
    case "parked":
    case "deferred":
    case "requiresDockerHost":
      return false;
  }
}
