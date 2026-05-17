/**
 * Dispatcher — the runtime. Reads baton, picks the awake phase, builds the
 * TickContext, invokes the agent, runs gates, decides handoff.
 *
 * One Dispatcher instance per repo. Stateless across ticks (everything it
 * needs comes from disk). `tick()` runs exactly one phase × one (or N for
 * fanout) agent invocation(s). `loop()` runs `tick()` until hibernation.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
import type {
  Chain,
  Phase,
  TickContext,
  TickResult,
} from "./Phase.js";
import { renderPrompt } from "./Prompt.js";
import * as git from "./git.js";

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
 * optional `agent` override. The per-tick resolver returns this; a rewritten
 * chain.ts changes the chain (and any `agent` export) for the next tick.
 */
export interface ChainModule {
  default: Chain;
  agent?: Agent;
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
    !!d && (d as { __esModule?: boolean }).__esModule === true && "default" in d;
  const chain = (interop ? d!.default : d) as Chain | undefined;
  const agent = (ns.agent ?? (interop ? d!.agent : undefined)) as
    | Agent
    | undefined;

  if (!chain || !Array.isArray((chain as { phases?: unknown }).phases)) {
    throw new Error(
      `${path} must default-export a Chain (an object with a phases[] array)`,
    );
  }
  return agent ? { default: chain, agent } : { default: chain };
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
export function diskChainLoader(
  configDir: string,
): () => Promise<ChainModule> {
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
   * Default agent. A `chain.ts` that exports `agent` overrides this per tick
   * (the agent re-resolves with the chain); otherwise this is used.
   */
  agent: Agent;
  /**
   * Chain resolver, invoked once per tick. Defaults to
   * `diskChainLoader(configDir)` (one load of `<configDir>/chain.ts` per
   * process). Override for in-process test injection only (no subprocess).
   */
  chainLoader?: () => Promise<ChainModule>;
  log?: Logger;
  /** Max parallel ticks per fanout batch. Default 4. */
  maxParallel?: number;
  /** Trunk branch name for cherry-pick. Default current branch at dispatch time. */
  trunkBranch?: string;
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
  private trunkBranch: string | null;
  private readonly pendingPath: string;
  private readonly chainLoader: () => Promise<ChainModule>;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.baton = new Baton(opts.repoRoot);
    this.log = opts.log ?? consoleLogger;
    this.maxParallel = opts.maxParallel ?? 4;
    this.tickTimeoutMs = opts.tickTimeoutMs;
    this.trunkBranch = opts.trunkBranch ?? null;
    this.pendingPath = join(opts.repoRoot, ".flume", "plan", "pending.json");
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
    const agent = chainModule.agent ?? this.opts.agent;

    const phase = chain.phases.find((p) => awake.includes(p.name));

    if (!phase) {
      return {
        hibernated: true,
        awakeAfter: [],
        summary: awake.length
          ? `awake flags reference unknown phases: ${awake.join(", ")}; hibernating`
          : "no phases awake; hibernating",
      };
    }

    if (!this.trunkBranch) {
      this.trunkBranch = await git.currentBranch(this.opts.repoRoot);
    }

    this.log.info(`[flume] tick → ${phase.name} (${phase.concurrency})`);

    const result =
      phase.concurrency === "singleton"
        ? await this.runSingleton(phase, agent)
        : await this.runFanout(phase, agent);

    // Sleep this phase by default; handoff re-wakes if needed.
    this.baton.sleep(phase.name);
    const handoff = phase.handoff(result);
    const allowed = handoff.filter((n) => !chain.humanOnly.includes(n));
    for (const name of allowed) this.baton.wake(name);

    return {
      hibernated: false,
      phaseName: phase.name,
      result,
      awakeAfter: this.baton.awake(),
      summary: summarize(phase.name, result, allowed),
    };
  }

  // ---------- singleton tick ----------

  private async runSingleton(phase: Phase, agent: Agent): Promise<TickResult> {
    const cwd = this.opts.repoRoot;
    const preHead = await git.revParse(cwd);
    const pending = await this.readPending();

    const ctx: TickContext = { cwd, pending };
    const args = phase.promptArgs?.(ctx) ?? {};
    const prompt = await renderPrompt({
      phase,
      promptFile: join(this.opts.configDir, phase.promptPath),
      cwd,
      args,
    });

    await this.invokeAgent(phase, cwd, prompt, agent);

    const postHead = await git.revParse(cwd);
    let committed = postHead !== preHead;
    const gateResults: GateResultEntry[] = [];

    if (committed) {
      const verdict = await this.runAfterCommitGates(phase, cwd, postHead);
      gateResults.push(...verdict.results);
      if (!verdict.ok) {
        await git.dropLastCommit(cwd);
        committed = false;
        this.log.warn(`[flume] ${phase.name} commit reverted: ${verdict.firstFailure}`);
      }
    }

    return {
      phaseName: phase.name,
      committed,
      ...(committed ? { commitSha: postHead } : {}),
      gateResults,
      pendingAfter: await this.readPending(),
      shippedTags: [],
    };
  }

  // ---------- fanout tick ----------

  private async runFanout(phase: Phase, agent: Agent): Promise<TickResult> {
    const repoRoot = this.opts.repoRoot;
    const preHead = await git.revParse(repoRoot);
    const pending = await this.readPending();

    const pickable = pending.filter((e) => isPickable(e, pending));

    if (pickable.length === 0) {
      this.log.info(`[flume] ${phase.name}: nothing pickable`);
      return {
        phaseName: phase.name,
        committed: false,
        gateResults: [],
        pendingAfter: pending,
        shippedTags: [],
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

    // Spawn worktrees in parallel.
    const worktrees = await Promise.all(
      batch.map((entry) => this.createWorktree(entry, preHead)),
    );

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
          extraEnvByIndex[i],
        ),
      ),
    );

    // Cherry-pick winners onto trunk in batch order.
    const shipped: { entry: PendingEntry; sha: string }[] = [];
    for (const r of perEntry) {
      if (!r.committed || !r.commitSha) continue;
      try {
        await git.cherryPick(repoRoot, r.commitSha);
        const newSha = await git.revParse(repoRoot);
        shipped.push({ entry: r.entry, sha: newSha });
        this.log.info(
          `[flume] cherry-picked ${r.entry.tag} → ${newSha.slice(0, 8)}`,
        );
      } catch (err) {
        this.log.warn(
          `[flume] cherry-pick failed for ${r.entry.tag}: ${(err as Error).message}; entry stays in pending`,
        );
        // Abort the in-progress cherry-pick so the working tree is clean for
        // subsequent ticks. Without this, partially-applied changes block
        // the next plan tick (which can't run `pnpm install` etc. against a
        // dirty trunk) and require manual `git restore` intervention.
        await git.cherryPickAbort(repoRoot);
      }
    }

    // Run afterMerge gates on the trunk.
    const mergeGateResults: GateResultEntry[] = [];
    let waveOk = true;
    if (shipped.length > 0) {
      for (const gate of phase.gates.filter((g) => g.when === "afterMerge")) {
        const headSha = await git.revParse(repoRoot);
        const r = await gate.run({
          cwd: repoRoot,
          phaseName: phase.name,
          commitSha: headSha,
          log: (l) => this.log.info(l),
        });
        mergeGateResults.push({ gate: gate.name, ok: r.ok, message: r.message });
        if (!r.ok) {
          this.log.warn(
            `[flume] afterMerge gate '${gate.name}' failed; reverting wave`,
          );
          await git.hardResetTo(repoRoot, preHead);
          waveOk = false;
          break;
        }
      }
    }

    // Update pending.json — remove shipped entries — as one harness commit.
    let chorSha: string | undefined;
    if (waveOk && shipped.length > 0) {
      const shippedTags = shipped.map((s) => s.entry.tag);
      chorSha = await this.commitPendingUpdate(pending, shippedTags);
      this.log.info(
        `[flume] ship commit ${chorSha.slice(0, 8)}: ${shippedTags.join(", ")}`,
      );
    }

    // Cleanup worktrees. Best-effort teardown fires before git.removeWorktree
    // so chain-provisioned ephemera (per-worktree DB, scratch lease, etc.)
    // releases while the worktree path still exists. Teardown failures are
    // logged but do not block worktree removal — leaks are recoverable, a
    // stuck worktree is not.
    let cleaned = 0;
    await Promise.all(
      worktrees.map(async (wt, i) => {
        if (phase.teardownWorktree) {
          try {
            await phase.teardownWorktree({
              worktreePath: wt.path,
              repoRoot,
              entryTag: batch[i]!.tag,
            });
          } catch (err) {
            this.log.warn(
              `[flume] teardownWorktree failed for ${wt.path}: ${(err as Error).message}`,
            );
          }
        }
        try {
          await git.removeWorktree(repoRoot, wt.path);
          cleaned++;
        } catch (err) {
          this.log.warn(
            `[flume] worktree cleanup failed for ${wt.path}: ${(err as Error).message}`,
          );
        }
        await git.deleteBranch(repoRoot, wt.branch);
      }),
    );
    this.log.info(
      `[flume] ${phase.name}: cleaned ${cleaned}/${worktrees.length} worktree(s)`,
    );
    this.log.info(
      `[flume] ${phase.name}: wave done in ${Date.now() - waveStart}ms`,
    );

    const allGateResults = perEntry.flatMap((r) => r.gateResults).concat(mergeGateResults);

    return {
      phaseName: phase.name,
      committed: waveOk && shipped.length > 0,
      ...(chorSha ? { commitSha: chorSha } : {}),
      gateResults: allGateResults,
      pendingAfter: await this.readPending(),
      shippedTags: waveOk ? shipped.map((s) => s.entry.tag) : [],
    };
  }

  // ---------- per-entry fanout ----------

  private async runFanoutEntry(
    phase: Phase,
    entry: PendingEntry,
    wt: { path: string; branch: string },
    agent: Agent,
    extraEnv?: Record<string, string>,
  ): Promise<{
    entry: PendingEntry;
    committed: boolean;
    commitSha?: string;
    gateResults: GateResultEntry[];
  }> {
    const ctx: TickContext = { cwd: wt.path, assignedEntry: entry };
    const args = phase.promptArgs?.(ctx) ?? {};
    const prompt = await renderPrompt({
      phase,
      promptFile: join(this.opts.configDir, phase.promptPath),
      cwd: wt.path,
      args,
    });

    const preHead = await git.revParse(wt.path);
    await this.invokeAgent(phase, wt.path, prompt, agent, extraEnv);
    const postHead = await git.revParse(wt.path);
    const committed = postHead !== preHead;

    const gateResults: GateResultEntry[] = [];
    if (!committed) {
      this.log.warn(`[flume] ${entry.tag}: agent produced no commit`);
      return { entry, committed: false, gateResults };
    }

    const verdict = await this.runAfterCommitGates(phase, wt.path, postHead);
    gateResults.push(...verdict.results);
    if (!verdict.ok) {
      await git.dropLastCommit(wt.path);
      this.log.warn(
        `[flume] ${entry.tag}: commit reverted (${verdict.firstFailure})`,
      );
      return { entry, committed: false, gateResults };
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
  ): Promise<void> {
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
        this.log.warn(
          `[flume] ${phase.name}: agent exited with code ${result.exitCode}`,
        );
      }
    } catch (err) {
      // Swallow abort/timeout/spawn errors so a single bad invocation doesn't
      // tear down the loop. The post-invocation `git rev-parse` still runs,
      // so any commit the agent managed to make before aborting is honored;
      // otherwise the phase falls through with `committed: false`.
      const e = err as Error & { name?: string; code?: string };
      const kind =
        e.name === "AbortError" || e.code === "ABORT_ERR"
          ? "aborted (timeout or signal)"
          : `errored: ${e.message}`;
      this.log.warn(`[flume] ${phase.name}: agent ${kind}`);
    }
  }

  private async runAfterCommitGates(
    phase: Phase,
    cwd: string,
    commitSha: string,
  ): Promise<{
    ok: boolean;
    firstFailure?: string;
    results: GateResultEntry[];
  }> {
    const gates: Gate[] = [
      ...phase.gates.filter((g) => g.when === "afterCommit"),
      writablePathsGate(phase.writablePaths),
    ];
    const results: GateResultEntry[] = [];
    for (const gate of gates) {
      const r: GateResult = await gate.run({
        cwd,
        phaseName: phase.name,
        commitSha,
        log: (l) => this.log.info(l),
      });
      results.push({ gate: gate.name, ok: r.ok, message: r.message });
      if (!r.ok) {
        if (r.details) this.log.warn(r.details);
        return { ok: false, firstFailure: r.message, results };
      }
    }
    return { ok: true, results };
  }

  private async createWorktree(
    entry: PendingEntry,
    fromRef: string,
  ): Promise<{ path: string; branch: string }> {
    const slug = entry.tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const branch = `flume/${slug}`;
    const path = join(this.opts.repoRoot, ".flume", "worktrees", slug);
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
  ): Promise<string> {
    const shipped = new Set(shippedTags);
    const after = before.filter((e) => !shipped.has(e.tag));
    await mkdir(dirname(this.pendingPath), { recursive: true });
    await writeFile(
      this.pendingPath,
      JSON.stringify(after, null, 2) + "\n",
      "utf8",
    );
    // Scoped to pending.json — `git add -A` would sweep up untracked worktree
    // metadata and unrelated user changes into the harness's chore commit.
    return git.commitPaths({
      cwd: this.opts.repoRoot,
      message: `chore(flume): ship ${shippedTags.join(", ")}`,
      paths: [this.pendingPath],
    });
  }
}

// ---------- loop supervisor (§2) ----------

/** Options for {@link superviseLoop}. */
export interface SuperviseLoopOptions {
  /** Repo root; the supervisor reads baton state here between child ticks. */
  repoRoot: string;
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
}

/**
 * `flume loop` supervisor (§2). Spawns exactly one `flume tick` child process
 * per iteration, carrying no in-memory chain or phase state across them — the
 * only correct re-resolution mechanism (Node's ESM registry is non-evictable,
 * so an in-process loop is pinned to chain.ts's first evaluation; see
 * `loadChainModule`). Between children it reads the on-disk baton
 * (disk-is-truth): no awake flags ⇒ hibernation ⇒ stop. A child that exits
 * non-zero (e.g. an ungated broken chain.ts: §3) is logged and the loop
 * proceeds — the supervisor never crashes. Bounded by `maxTicks` (the
 * `--max N` cap); observable `--max`/hibernation behavior is unchanged from
 * the prior in-process loop.
 */
export async function superviseLoop(
  opts: SuperviseLoopOptions,
): Promise<SuperviseResult> {
  const log = opts.log ?? consoleLogger;
  const maxTicks = opts.maxTicks ?? 50;
  const baton = new Baton(opts.repoRoot);
  const runTick = opts.runTick ?? defaultTickRunner(opts.repoRoot);

  let ticks = 0;
  for (let i = 0; i < maxTicks; i++) {
    const { exitCode } = await runTick();
    ticks++;
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
      return { ticks, hibernated: true };
    }
  }
  log.info(`[flume] reached --max ${maxTicks}; stopping`);
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
): string {
  const parts: string[] = [phaseName];
  if (result.committed) {
    if (result.shippedTags.length > 0) {
      parts.push(`shipped ${result.shippedTags.join(", ")}`);
    } else if (result.commitSha) {
      parts.push(`committed ${result.commitSha.slice(0, 8)}`);
    }
  } else {
    parts.push("no commit");
  }
  if (awaking.length > 0) parts.push(`→ ${awaking.join(",")}`);
  else parts.push(`→ hibernate`);
  return parts.join(" ");
}

/**
 * Pickability in the fanout context. The dispatcher's model: a dep is
 * satisfied iff it is no longer in pending (we remove entries on ship).
 * `requiresDockerHost` is opt-in and deferred to v1.
 */
function isPickable(
  entry: PendingEntry,
  pending: readonly PendingEntry[],
): boolean {
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
