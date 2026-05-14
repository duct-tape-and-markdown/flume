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
import { join, dirname } from "node:path";

import type { Agent } from "./Agent.ts";
import { Baton } from "./Baton.ts";
import type { Gate, GateResult } from "./Gate.ts";
import { writablePathsGate } from "./builtinGates.ts";
import { partitionByFileOverlap } from "./partition.ts";
import { parsePending } from "./PendingSchema.ts";
import type { PendingEntry } from "./PendingSchema.ts";

/** Local-mutable shape for accumulating gate results before they widen to TickResult.gateResults. */
type GateResultEntry = { gate: string; ok: boolean; message: string };
import type {
  Chain,
  Phase,
  TickContext,
  TickResult,
} from "./Phase.ts";
import { renderPrompt } from "./Prompt.ts";
import * as git from "./git.ts";

// ---------- public surface ----------

export interface Logger {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

export const consoleLogger: Logger = {
  info: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

export interface DispatcherOptions {
  chain: Chain;
  repoRoot: string;
  /** Directory the chain config (and its prompt files) live in. */
  configDir: string;
  agent: Agent;
  log?: Logger;
  /** Max parallel ticks per fanout batch. Default 4. */
  maxParallel?: number;
  /** Trunk branch name for cherry-pick. Default current branch at dispatch time. */
  trunkBranch?: string;
}

export interface TickOutcome {
  hibernated: boolean;
  phaseName?: string;
  result?: TickResult;
  /** Phase names awake after this tick. */
  awakeAfter: string[];
  /** One-line summary suitable for log output. */
  summary: string;
}

export class Dispatcher {
  private readonly opts: DispatcherOptions;
  private readonly baton: Baton;
  private readonly log: Logger;
  private readonly maxParallel: number;
  private trunkBranch: string | null;
  private readonly pendingPath: string;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.baton = new Baton(opts.repoRoot);
    this.log = opts.log ?? consoleLogger;
    this.maxParallel = opts.maxParallel ?? 4;
    this.trunkBranch = opts.trunkBranch ?? null;
    this.pendingPath = join(opts.repoRoot, ".flume", "plan", "pending.json");
  }

  /** Run one phase × one tick. Returns hibernated outcome if nothing awake. */
  async tick(): Promise<TickOutcome> {
    const awake = this.baton.awake();
    const phase = this.opts.chain.phases.find((p) => awake.includes(p.name));

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
        ? await this.runSingleton(phase)
        : await this.runFanout(phase);

    // Sleep this phase by default; handoff re-wakes if needed.
    this.baton.sleep(phase.name);
    const handoff = phase.handoff(result);
    const allowed = handoff.filter(
      (n) => !this.opts.chain.humanOnly.includes(n),
    );
    for (const name of allowed) this.baton.wake(name);

    return {
      hibernated: false,
      phaseName: phase.name,
      result,
      awakeAfter: this.baton.awake(),
      summary: summarize(phase.name, result, allowed),
    };
  }

  /** Run ticks until hibernation or until maxTicks reached. */
  async loop(maxTicks = 50): Promise<TickOutcome[]> {
    const outcomes: TickOutcome[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const outcome = await this.tick();
      outcomes.push(outcome);
      this.log.info(`[flume] ${outcome.summary}`);
      if (outcome.hibernated) break;
    }
    return outcomes;
  }

  // ---------- singleton tick ----------

  private async runSingleton(phase: Phase): Promise<TickResult> {
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

    await this.invokeAgent(phase, cwd, prompt);

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

  private async runFanout(phase: Phase): Promise<TickResult> {
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

    const batches = partitionByFileOverlap(pickable, {
      maxParallel: this.maxParallel,
    });
    const batch = batches[0]!;
    this.log.info(
      `[flume] ${phase.name}: fanout ${batch.length}/${pickable.length} pickable in batch 1/${batches.length}`,
    );

    // Spawn worktrees in parallel.
    const worktrees = await Promise.all(
      batch.map((entry) => this.createWorktree(entry, preHead)),
    );

    // Optional per-phase setup (e.g. symlink node_modules / .env so gates run).
    if (phase.setupWorktree) {
      await Promise.all(
        batch.map((entry, i) =>
          phase.setupWorktree!({
            worktreePath: worktrees[i]!.path,
            repoRoot,
            entryTag: entry.tag,
          }),
        ),
      );
    }

    // Run agent in each worktree concurrently.
    const perEntry = await Promise.all(
      batch.map((entry, i) => this.runFanoutEntry(phase, entry, worktrees[i]!)),
    );

    // Cherry-pick winners onto trunk in batch order.
    const shipped: { entry: PendingEntry; sha: string }[] = [];
    for (const r of perEntry) {
      if (!r.committed || !r.commitSha) continue;
      try {
        await git.cherryPick(repoRoot, r.commitSha);
        const newSha = await git.revParse(repoRoot);
        shipped.push({ entry: r.entry, sha: newSha });
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
      chorSha = await this.commitPendingUpdate(
        pending,
        shipped.map((s) => s.entry.tag),
      );
    }

    // Cleanup worktrees.
    await Promise.all(
      worktrees.map(async (wt) => {
        try {
          await git.removeWorktree(repoRoot, wt.path);
        } catch (err) {
          this.log.warn(
            `[flume] worktree cleanup failed for ${wt.path}: ${(err as Error).message}`,
          );
        }
        await git.deleteBranch(repoRoot, wt.branch);
      }),
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
    await this.invokeAgent(phase, wt.path, prompt);
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
  ): Promise<void> {
    const result = await this.opts.agent.invoke({
      cwd,
      prompt,
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (result.exitCode !== 0) {
      this.log.warn(
        `[flume] ${phase.name}: agent exited with code ${result.exitCode}`,
      );
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
