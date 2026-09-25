/**
 * The one agent attempt a tick makes inside a provisioned worktree: resolve
 * the prompt args, render, read the tip, invoke the agent, verify the tip,
 * run the afterCommit gates, and revert what they refused.
 *
 * Both concurrencies run exactly this sequence — a singleton on the
 * wave-of-one worktree it provisioned for the phase (spec/worktrees.md,
 * "Singleton runs in a worktree"), a fanout entry on its own — so it lives in
 * the file its name is rather than as a second job inside whichever leg
 * reaches it (`.claude/rules/engineering.md`, *A module is one job*). The
 * `shouldRun` consult that decides whether to make the attempt at all comes
 * with it, since its refusal record is the attempt's own. What surrounds the
 * attempt — the merge stage (`src/waveMerge.ts` for a wave,
 * `src/singletonTick.ts` for a singleton), the verdict vocabulary each
 * concurrency reports in — stays outside this file.
 *
 * Every function here takes its runtime state as an {@link AttemptContext}
 * rather than reading a field off the orchestrator, so the sequence is
 * callable from anything that can name those roots and stores.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Agent, AgentUsage } from "./Agent.js";
import { writablePathsGate } from "./builtinGates.js";
import type { Gate, GateResult } from "./Gate.js";
import { runGate } from "./gateRun.js";
import * as git from "./git.js";
import type { Logger } from "./log.js";
import {
  entryWriteScope,
  fsStamp,
  namespacedJoin,
  phasePromptPath,
  renderedPromptsDir,
  slugify,
  STATE_ROOT_NAMES,
} from "./paths.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Chain, Phase, TickContext } from "./Phase.js";
import { blamedOn } from "./selection.js";
import {
  buildCleanExit,
  buildGateRevert,
  buildPlatformPreempt,
  buildRenderRefused,
  buildTipMoved,
  PriorAttemptStore,
  type PriorAttemptRef,
} from "./priorAttempts.js";
import { renderPrompt, InlineExecRenderError } from "./Prompt.js";
import type { NoCommitMode } from "./Prompt.js";
import {
  gateFailureSignature,
  reportedGateRow,
  throwFacts,
  type GateFailure,
  type ReportedGateResult,
} from "./tickVerdict.js";
import type { WorktreeContext } from "./worktrees.js";

const execFileP = promisify(execFile);

/**
 * The runtime state one attempt reads — the roots it resolves paths against,
 * the stores it writes records through, and the logger it narrates to. A
 * dispatcher composes it per attempt from what it already holds; nothing here
 * is re-derived from disk.
 *
 * `configDirRel` is the escape verdict for `configDir` against the repo root,
 * folded once by its owner (`computeStateRootRel`) and handed in, so the gate
 * loop below rebases a config dir onto a worktree without re-deriving the
 * check (`.claude/rules/engineering.md`, *A fact the engine holds is
 * reported, never rediscovered*).
 */
export interface AttemptContext {
  /** Resolved against the primary checkout — the prompt file's root, and the gate context's `configDir` before rebasing. */
  readonly configDir: string;
  /** `configDir` relative to the repo root in git's alphabet, or `undefined` when it escapes the repo. */
  readonly configDirRel: string | undefined;
  /** The state root — where rendered prompts and friction notes are written. */
  readonly flumeDir: string;
  /** The state root's own escape verdict, reported to every gate as `GateContext.stateRootRel`. */
  readonly stateRootRel: string | undefined;
  /** The pending ledger's resolved path, reported to every gate. */
  readonly pendingDir: string;
  /** Scopes a gate's checkouts, so a gate that crashed mid-run cannot leak the tree it was reading. */
  readonly worktreeCtx: WorktreeContext;
  /** Where this attempt reads its retry input from and writes every refusal record to. */
  readonly attempts: PriorAttemptStore;
  /** What the tick's chain declared about how long an agent invocation runs. */
  readonly bounds: AgentBounds;
  /** The tick's own teardown signal, reaching the agent process it started. */
  readonly stopSignal?: AbortSignal;
  readonly log: Logger;
}
/**
 * How an agent invocation ended. A clean exit with no usable commit is a
 * clean-exit (the agent refused a constraint and said so in its final
 * message, captured here as `finalMessage` — lifted from the transcript by
 * the adapter's own `extractFinalMessage`, spec/chain.md "The agent seam");
 * any process failure is a platform-preempt (not a defect in the work); the
 * no-commit classification consults this distinction only when the tick
 * produced nothing usable.
 *
 * `finalMessage` has two readers and no others: the clean-exit record
 * `classifyNoCommit` writes, and that record's render into the retry's
 * prompt (`src/Prompt.ts`). When a commit lands it reaches nothing —
 * `ShipContext` (`src/Phase.ts`) carries neither the message nor the
 * termination, because a landed commit is classified from what is on disk
 * rather than from what the process said (spec/pending.md "Ship detection
 * trusts the agent's own account").
 *
 * `promptPath` is the persisted rendered prompt the run was handed
 * (spec/prompt.md "The rendered prompt is persisted before the agent runs").
 * On the termination rather than beside it because `invokeAgent` is the one
 * seam every run passes through: a run cannot exist without its record, and
 * the type says so instead of a call-order comment.
 */
type AgentTermination =
  | { kind: "clean"; promptPath: string; finalMessage: string; usage?: AgentUsage }
  | { kind: "process-failure"; promptPath: string; failureClass: string; usage?: AgentUsage };

/**
 * What one agent attempt left behind, whatever fate it reached — the record
 * half of {@link AttemptOutcome}.
 */
type AttemptFacts = {
  /** Every afterCommit gate row this attempt produced, the failing row included. */
  gateResults: ReportedGateResult[];
  /** No-commit mode when the attempt produced no usable commit; absent when its span survived. */
  noCommit?: NoCommitMode;
  /**
   * The tip-verify backstop refused: the base this worktree branched from is
   * no longer an ancestor of the HEAD the agent left on its private branch,
   * so the span was soft-reset and never reached the merge stage.
   */
  tipMoved?: boolean;
  /**
   * The reverted commit's touched paths, captured before `dropLastCommit`
   * discarded it — set only alongside `noCommit: "gate-revert"`, so a caller
   * can land the footprint that never reached trunk on its own.
   */
  footprint?: string[];
  /** Set only alongside `noCommit: "gate-revert"` — the blamed record of the failing gate. */
  gateFailure?: GateFailure;
};

/**
 * The outcome of {@link runAttempt} — render → tip read → invoke
 * → tip verify → afterCommit gates → revert — in the one vocabulary both
 * concurrencies' merge stages read.
 *
 * `committed` discriminates. A committed attempt always names the span it
 * produced and the termination that produced it, so neither caller's merge
 * stage reaches for an assertion to pick it up. An uncommitted one carries
 * `spanBase` once the agent ran at all (the tip it branched from, reported
 * as the tick's `baseSha`), `headSha` when a commit landed and was then lost
 * — to the ancestry refusal, the afterCommit revert, or an empty span's own
 * arm — and `termination`
 * whenever `invokeAgent` ran — all three absent when the render refused.
 */
export type AttemptOutcome =
  | (AttemptFacts & {
      committed: true;
      /**
       * The tip the agent branched from — read inside the worktree right
       * before the invocation, so a `setupWorktree` commit is already behind
       * it. The ancestry check's base, the afterCommit gates' span base, and
       * the start of the range the merge stage picks.
       */
      spanBase: string;
      /** The span's tip: the worktree HEAD the agent left, gates green. */
      headSha: string;
      termination: AgentTermination;
    })
  | (AttemptFacts & {
      committed: false;
      spanBase?: string;
      headSha?: string;
      termination?: AgentTermination;
    });

/**
 * What a tick's chain declares about how long an agent invocation runs and how
 * long its tree gets to go — the two `AgentInvocation` (`src/Agent.ts`)
 * fields a tick carries over from its `supervisorPolicy` (`src/Phase.ts`), in
 * that seam's own optional shape: absent is what tells a provider nothing was
 * declared.
 */
export interface AgentBounds {
  timeoutMs?: number;
  killGraceMs?: number;
}

/**
 * The sequence itself: render → tip read → invoke → tip verify → afterCommit
 * gates → revert, on the worktree the caller provisioned — a singleton on the
 * wave-of-one it took for the phase (spec/worktrees.md, "Singleton runs in a
 * worktree"), a fanout entry on its own.
 *
 * What each caller still owns is what surrounds the attempt: the
 * `shouldRun` consult (a singleton takes it before provisioning, so a
 * decline costs no worktree; a fanout entry takes it per entry, after),
 * the merge stage, and the verdict vocabulary each reports in.
 */
export async function runAttempt(
  ctx: AttemptContext,
  opts: {
    phase: Phase;
    chain: Chain;
    agent: Agent;
    /** The worktree this attempt runs in — provisioned and set up by the caller. */
    wt: { path: string; branch: string };
    /**
     * This attempt's `TickContext`, built by the caller: a singleton reads
     * the whole queue and carries no assignment, a fanout entry carries its
     * assignment and no queue.
     */
    ctx: TickContext;
    /**
     * The prior-attempt slot this attempt reads its retry input from and
     * writes every refusal record to. It lives at the repo root, not in this
     * fresh worktree, so a reverted attempt's record survives into the next
     * tick's brand-new one.
     */
    ref: PriorAttemptRef;
    /** What every log line and record here is keyed by: the entry tag under fanout, the phase name for a singleton. */
    label: string;
    /** The entry a fanout attempt carries; absent for a singleton, which assigns none. */
    entry?: PendingEntry;
    extraEnv?: Record<string, string>;
  },
): Promise<AttemptOutcome> {
  const { phase, chain, agent, wt, ctx: tickCtx, ref, label, entry } = opts;
  const prior = await ctx.attempts.read(ref);

  const argsResult = await resolvePromptArgs(ctx, phase, tickCtx, ref, label);
  if (!argsResult.ok) {
    // A thrown `promptArgs` never reaches the render, and lands on the
    // render's own refusal — same no-commit mode, same persisted record
    // (spec/chain.md, "What a hook receives").
    return { committed: false, gateResults: [], noCommit: "render-refused" };
  }

  let prompt: string;
  try {
    prompt = await renderPrompt({
      phase,
      flumeDir: ctx.flumeDir,
      promptFile: phasePromptPath(ctx.configDir, phase.promptPath),
      cwd: wt.path,
      args: argsResult.args,
      ...(entry ? { assignedEntry: entry } : {}),
      ...(prior ? { priorAttempt: prior } : {}),
    });
  } catch (err) {
    if (!(err instanceof InlineExecRenderError)) throw err;
    // An unresolved inline-exec span aborts the render — the agent is
    // never invoked. Distinct from clean-exit/platform-preempt: no agent
    // ran at all.
    await persistRenderRefused(ctx, ref, label, err);
    return { committed: false, gateResults: [], noCommit: "render-refused" };
  }

  // Fresh read, not the tip the worktree was provisioned from: the two
  // agree unless `setupWorktree` itself committed something.
  const spanBase = await git.revParse(wt.path);
  const termination = await invokeAgent(
    ctx,
    phase,
    ref.key,
    wt.path,
    prompt,
    agent,
    opts.extraEnv,
    entry?.tag,
  );
  const headSha = await git.revParse(wt.path);

  // Two shapes of "no usable commit", one arm: the ref never moved, or it
  // moved across a span whose cumulative diff against its base is empty. An
  // empty span cannot be absorbed — `git cherry-pick base..head` over a
  // range that changes nothing exits 1 — so left to reach the merge stage it
  // read as a cherry-pick conflict and quarantined the entry for the rest of
  // the run (spec/loop.md "The no-commit taxonomy", `clean-exit`). It dies
  // with the worktree here instead, before the gate loop and before the pick.
  //
  // One `git diff` for the whole span, and the only one: the gate loop below
  // takes this same footprint rather than re-deriving it, and the revert path
  // lands it on trunk from here too
  // (.claude/rules/engineering.md "The fix lands at the mechanism").
  const spanTouchedPaths =
    headSha === spanBase
      ? []
      : await git.diffNameOnly(wt.path, spanBase, headSha);
  const emptySpan = headSha !== spanBase && spanTouchedPaths.length === 0;
  if (headSha === spanBase || emptySpan) {
    // Classify and persist the matching prior-attempt record — the durable
    // channel, so an attempt that keeps exiting clean at the same wall is
    // legible without reading session logs. A clean exit that produced
    // nothing usable is a clean-exit; any process failure is a
    // platform-preempt (not a defect in the work) — consulted here for the
    // empty span too, since a span that cannot ship is no reason to let a
    // platform failure masquerade as an agent's own exit.
    const mode = await classifyNoCommit(ctx, ref, termination, {
      spanBase,
      spanHead: headSha,
    });
    ctx.log.warn(
      `[flume] ${label}: ${mode} (${emptySpan ? "empty span" : "no commit"})`,
    );
    return {
      committed: false,
      gateResults: [],
      noCommit: mode,
      spanBase,
      // Only when a commit was made and then dropped as unusable: an
      // unmoved ref has no span tip to name.
      ...(emptySpan ? { headSha } : {}),
      termination,
    };
  }

  // Tip verify (spec/loop.md "Tip verify — one writer per branch,
  // absorption at the merge"): the agent commits directly in this
  // worktree, so verify after the fact — but ancestry, not parent
  // equality. The worktree's own branch is private to this attempt, so an
  // agent that commits, keeps working, and commits again has produced a
  // completed multi-commit span, not interference; only a base that is no
  // longer an ancestor of the observed HEAD means something reset or
  // rewrote the branch out from under the agent.
  if (await checkTipMovedPerEntry(ctx, wt.path, label, ref, spanBase, headSha)) {
    return {
      committed: false,
      gateResults: [],
      tipMoved: true,
      spanBase,
      headSha,
      termination,
    };
  }

  // The ancestry check above cleared the whole span as one completed unit
  // (spec/loop.md "The check is ancestry, and N commits are completion") —
  // gate the span's cumulative footprint, not just `headSha`'s own
  // single-commit diff, so a gate can't miss what an earlier commit in the
  // span touched.
  const verdict = await runAfterCommitGates(
    ctx,
    phase,
    wt.path,
    headSha,
    entry,
    spanBase,
    spanTouchedPaths,
  );
  if (!verdict.ok) {
    // This revert never reaches the merge stage, so it's the only chance
    // to capture what the commit actually touched — the empty-span read
    // above already computed it, and the gate loop ran off that same value
    // (.claude/rules/engineering.md "The fix lands at the mechanism"), so
    // reuse it instead of re-deriving via a second `git show --name-only`
    // before dropLastCommit discards the evidence.
    const { footprint, gateFailure } = await revertAfterCommitFailure(
      ctx,
      chain,
      wt.path,
      headSha,
      ref,
      label,
      entry,
      verdict.failure!,
      spanTouchedPaths,
    );
    return {
      committed: false,
      gateResults: verdict.results,
      noCommit: "gate-revert",
      footprint,
      gateFailure,
      spanBase,
      headSha,
      termination,
    };
  }

  return {
    committed: true,
    gateResults: verdict.results,
    spanBase,
    headSha,
    termination,
  };
}

/**
 * Tip verify's guarded revert, for a commit the agent
 * made itself. `expectedSha` is `postHead`, the commit this call's own
 * caller just observed.
 *
 * Mirrors `git.dropLastCommit`'s guarded-revert idiom, reconfirming the
 * tip is still `expectedSha` immediately
 * before resetting, so a second race (the ref moving again in the gap
 * between observing `postHead` and reverting it) refuses loudly rather
 * than silently dropping a commit this call never observed at the tip.
 * Soft, not hard, unlike `dropLastCommit`: the agent's work was never at
 * fault, so it survives as uncommitted changes on disk rather than being
 * discarded.
 *
 * `resetToSha` is always the recorded base — every worktree branch (a
 * fanout entry's, or, since spec/worktrees.md "Singleton runs in a
 * worktree", a singleton phase's own) is a private ref with exactly one
 * legitimate writer, so the target is always that branch's own start
 * point. The trunk's former shared-ref ambiguity — which needed a
 * commit-*count* revert because the dispatcher couldn't tell its own
 * commits from an interleaved operator's — no longer has a caller: a
 * singleton tick's agent now commits on a private branch same as a fanout
 * entry's, never on the trunk directly.
 */
async function revertTipMovedCommit(
  cwd: string,
  expectedSha: string,
  resetToSha: string,
): Promise<void> {
  const currentTip = await git.revParse(cwd);
  if (currentTip !== expectedSha) {
    throw new Error(
      `tip-verify revert refused: current tip ${currentTip} does not ` +
        `match expected ${expectedSha} — this call did not observe the ` +
        `commit at the current tip, refusing to reset`,
    );
  }
  await git.softResetTo(cwd, resetToSha);
}

/**
 * Tip verify (spec/loop.md "Tip verify — one writer per branch, absorption
 * at the merge", "Per-entry leg — private ref, ancestry, N commits are
 * completion"). Every worktree branch — a fanout entry's or a singleton
 * phase's own (spec/worktrees.md "Singleton runs in a worktree") — has
 * exactly one legitimate writer: this tick's agent. The check is ancestry
 * — the recorded base must be an ancestor of the observed HEAD — so a
 * multi-commit span never trips this on its own account; the caller runs
 * the whole span's gates and cherry-picks it like a single-commit entry
 * once this returns `false`.
 *
 * Refusal fires only when the base is *not* an ancestor of `postHead`,
 * which on a private branch means something reset or rewrote it out from
 * under the agent. Both the log line and the persisted record name
 * `postHead` itself as the observed tip — never `postHead`'s parent alone,
 * which would read the agent's own work as the intruder and leave the top
 * commit undiscoverable (the flume 0.10.1 field trace this split closes).
 */
async function checkTipMovedPerEntry(
  ctx: AttemptContext,
  cwd: string,
  label: string,
  ref: PriorAttemptRef,
  preHead: string,
  postHead: string,
): Promise<boolean> {
  const ancestor = await git.isAncestor(cwd, preHead, postHead);
  if (ancestor) return false;
  await revertTipMovedCommit(cwd, postHead, preHead);
  await ctx.attempts.write(ref, buildTipMoved(preHead, postHead));
  ctx.log.warn(
    `[flume] ${label}: tip moved (no commit) — expected ${preHead}, found ${postHead}`,
  );
  return true;
}

async function invokeAgent(
  ctx: AttemptContext,
  phase: Phase,
  key: string,
  cwd: string,
  prompt: string,
  agent: Agent,
  extraEnv?: Record<string, string>,
  /**
   * The provisioned entry's tag under fanout; omitted by the singleton
   * caller, which has no entry — the same rule the `TickVerdictInvocation`
   * (`src/tickVerdict.ts`) row this call produces already follows.
   */
  entryTag?: string,
): Promise<AgentTermination> {
  // Before the try: a record that cannot be written refuses the run
  // outright rather than reading as a platform-preempt of a run that
  // never started (.claude/rules/engineering.md "Loud or nothing").
  const promptPath = await recordRenderedPrompt(ctx, key, prompt);
  try {
    const result = await agent.invoke({
      cwd,
      prompt,
      ...(entryTag !== undefined ? { entryTag } : {}),
      ...ctx.bounds,
      // The tick's own teardown, reaching the one process a tick starts
      // that outlives a bare `process.exit` (spec/loop.md, "The loop lock
      // and the tip claim").
      ...(ctx.stopSignal !== undefined ? { signal: ctx.stopSignal } : {}),
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
      ...(extraEnv ? { extraEnv } : {}),
    });
    if (result.exitCode !== 0) {
      // A non-zero exit is a process failure, not the agent's own clean
      // exit: crash, OOM/SIGKILL, auth, or rate-limit surfaced as a
      // non-zero code. A platform-preempt — not a defect in the work.
      const failureClass = `agent process exited with code ${result.exitCode} (non-work failure: crash, kill, auth, or rate-limit surfaced as a non-zero exit)`;
      ctx.log.warn(`[flume] ${phase.name}: ${failureClass}`);
      return {
        kind: "process-failure",
        promptPath,
        failureClass,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    }
    // Clean exit. `result.finalMessage` is the agent's closing prose,
    // already lifted from the full transcript by the adapter — recorded
    // verbatim, read for intent by the chain and never here.
    return {
      kind: "clean",
      promptPath,
      finalMessage: result.finalMessage ?? "",
      ...(result.usage ? { usage: result.usage } : {}),
    };
  } catch (err) {
    // Swallow abort/timeout/spawn errors so a single bad invocation doesn't
    // tear down the loop. The post-invocation `git rev-parse` still runs,
    // so any commit the agent managed to make before aborting is honored;
    // otherwise the phase falls through with `committed: false`. Either way
    // this is a platform-preempt — not a defect in the work.
    const e = err as Error & { name?: string; code?: string };
    const failureClass =
      e.name === "AbortError" || e.code === "ABORT_ERR"
        ? "agent process aborted (per-tick timeout or dispatcher signal)"
        : `agent process error before exit: ${e.message}`;
    ctx.log.warn(`[flume] ${phase.name}: ${failureClass}`);
    return { kind: "process-failure", promptPath, failureClass };
  }
}

async function runAfterCommitGates(
  ctx: AttemptContext,
  phase: Phase,
  cwd: string,
  commitSha: string,
  assignedEntry: PendingEntry | undefined,
  /**
   * The span's base — `baseSha` on every gate context this loop builds.
   * Both a fanout entry's worktree branch and a
   * singleton phase's own (spec/worktrees.md "Singleton runs in a
   * worktree") are private refs whose ancestry check clears a multi-commit
   * span as one completed tick.
   */
  spanBase: string,
  /**
   * The cumulative `spanBase..commitSha` diff rather than `commitSha`'s own
   * single-commit diff — the whole-span gate (spec/loop.md "The check is
   * ancestry, and N commits are completion"). Handed in rather than derived
   * here: the caller already read this diff to decide whether the span was
   * empty at all, and one span's footprint is one `git diff`
   * (.claude/rules/engineering.md "The fix lands at the mechanism"). The one
   * array reaches every gate in the loop below by identity, so a gate cannot
   * see a footprint a sibling gate did not.
   */
  spanTouchedPaths: string[],
): Promise<{
  ok: boolean;
  /** First failing gate — the same row `results` carries, so a prior-attempt
   * record a caller persists from it cannot name a different failure than the
   * verdict reports. */
  failure?: ReportedGateResult;
  results: ReportedGateResult[];
}> {
  // Entry-scoped write guard (spec/pending.md, "The entry-scoped write
  // guard is opt-in, and off by default"). The whole decision — whether
  // this tick is scoped at all, and to which paths — is `entryWriteScope`
  // (`src/paths.ts`), the one call `renderPrompt` also makes to state the
  // fence in the agent's prompt (.claude/rules/engineering.md "The fix
  // lands at the mechanism"). Unscoped, a fanout tick's allowance is
  // byte-identical to a singleton tick's — `writablePaths` alone.
  const gates: Gate[] = [
    ...phase.gates.filter((g) => g.when === "afterCommit"),
    writablePathsGate(
      phase.writablePaths,
      entryWriteScope(phase, assignedEntry),
    ),
  ];
  // `cwd` here is the fanout worktree (or a singleton's own worktree,
  // spec/worktrees.md "Singleton runs in a worktree") — a fresh checkout
  // that holds only tracked files at the same relative layout as the
  // primary checkout. `ctx.configDir` is resolved against the primary
  // checkout, so an in-repo configDir is rebased onto `cwd` at its own
  // relative offset rather than passed through verbatim, or a configDir
  // relocated *within* the repo would point a gate at the wrong tree
  // entirely. A configDir relocated *outside* the repo has no worktree
  // mirror to rebase onto — the checkout carries only tracked files — so it
  // passes through verbatim, and the escape test that decides which case
  // this is arrives as `ctx.configDirRel`, folded once by the one owner of
  // that computation rather than re-derived here
  // (`.claude/rules/engineering.md` "The fix lands at the mechanism").
  const configDir =
    ctx.configDirRel === undefined
      ? ctx.configDir
      : join(cwd, ctx.configDirRel);
  const results: ReportedGateResult[] = [];
  for (const gate of gates) {
    const r: GateResult = await runGate(
      gate,
      {
        cwd,
        repoRoot: cwd,
        flumeDir: ctx.flumeDir,
        stateRootRel: ctx.stateRootRel,
        pendingDir: ctx.pendingDir,
        configDir,
        phaseName: phase.name,
        commitSha,
        touchedPaths: spanTouchedPaths,
        baseSha: spanBase,
        ...(assignedEntry ? { entry: assignedEntry } : {}),
        log: (l) => ctx.log.info(l),
      },
      ctx,
    );
    const row = reportedGateRow(gate.name, r);
    results.push(row);
    if (!r.ok) {
      if (r.details) ctx.log.warn(r.details);
      return { ok: false, failure: row, results };
    }
  }
  return { ok: true, results };
}

/**
 * The one `afterCommit`-revert path (spec/worktrees.md "Reverted prose
 * survives the reset"): every afterCommit gate revert — a fanout entry's
 * worktree commit or, since singleton moved into a worktree too
 * (spec/worktrees.md "Singleton runs in a worktree"), a singleton phase's
 * own — snapshots the commit's files before dropping it and writes the
 * operator's revert note, whichever worktree it ran in. The former
 * asymmetry — snapshot singleton-only, note fanout-only — collapsed with
 * the paths themselves once both concurrencies commit to a private branch
 * a tick tears down at the end.
 *
 * `label` names the entry tag or the phase name — both the revert note's
 * filename and the log line use it. `blamed` is the fanout entry this
 * revert is scoped to, and `undefined` for a singleton phase's own revert
 * (no entry to quarantine — see the doc on `StageFailureEntry`
 * (`src/tickVerdict.ts`)). The entry, not its tag: the returned
 * {@link GateFailure} carries the quarantine key
 * beside the tag, and only the entry as read can supply it. A gate that
 * declared `blamesSpan: false` leaves even a fanout revert unblamed —
 * having an entry to blame is not the same as the gate blaming it.
 */
async function revertAfterCommitFailure(
  ctx: AttemptContext,
  chain: Chain,
  cwd: string,
  sha: string,
  ref: PriorAttemptRef,
  label: string,
  blamed: PendingEntry | undefined,
  failure: ReportedGateResult,
  touchedPaths: string[],
): Promise<{ footprint: string[]; gateFailure: GateFailure }> {
  const record = await buildGateRevert("afterCommit", failure, cwd, sha);
  await writeRevertNote(ctx, chain, cwd, sha, label, failure);
  await ctx.attempts.snapshotReverted(cwd, sha, ref);
  await git.dropLastCommit(cwd, sha);
  await ctx.attempts.write(ref, record);
  ctx.log.warn(`[flume] ${label}: commit reverted (${failure.message})`);
  return {
    footprint: touchedPaths,
    gateFailure: {
      // Blamed only when there is an entry to blame *and* the gate did not
      // disown the span: `blamesSpan: false` puts a fanout entry's revert in
      // the same unblamed class a singleton's own revert is already in
      // (spec/chain.md "What a gate returns").
      ...(blamed && failure.blamesSpan !== false ? blamedOn(blamed) : {}),
      signature: gateFailureSignature(failure),
      message: failure.message,
    },
  };
}

/**
 * Subject + body of a commit, read while `sha` is still reachable (before
 * the hard reset / commit drop). Best-effort: a failure here must not
 * block the revert path.
 */
async function capturedCommitMessage(
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
 * When an afterCommit gate reverts a worktree's
 * commit and `Chain.friction` is declared, write the operator's copy of
 * the verdict — the gate name/message/details plus the reverted commit's
 * subject+body — to `<friction>/<ISO-timestamp>--<tag>--reverted.md`
 * before `git.dropLastCommit` discards the evidence. Written straight to
 * the primary friction dir (harness code reaching into `flumeDir`, the
 * sessions/harvest precedent) rather than the worktree-local mirror —
 * this runs mid-wave (or mid-singleton-tick), well before that worktree's
 * own teardown harvest.
 *
 * `tag` is the fanout entry's tag or, for a singleton phase's own
 * afterCommit revert, the phase name (spec/worktrees.md "Singleton runs in
 * a worktree" collapsed the former asymmetry — the note used to be
 * fanout-only, since a singleton commit lived in the operator's own
 * checkout until it was gated; now it lives in a worktree the tick tears
 * down, so the note is what remains).
 *
 * Undeclared `chain.friction` is a no-op. Best-effort: a
 * note-write failure must never block the revert it is documenting.
 */
async function writeRevertNote(
  ctx: AttemptContext,
  chain: Chain,
  cwd: string,
  sha: string,
  tag: string,
  failure: { gate: string; message: string; details?: string },
): Promise<void> {
  if (chain.friction === undefined) return;
  try {
    const { subject, body } = await capturedCommitMessage(cwd, sha);
    const stamp = fsStamp();
    const primaryDir = join(ctx.flumeDir, chain.friction);
    // win32 MAX_PATH (`.claude/rules/platform-facts.md`): TAG_MAX_LENGTH
    // bounds only the filename component, not the friction dir's full
    // depth. namespacedJoin (src/paths.ts) is the shared idiom.
    await mkdir(namespacedJoin(primaryDir), { recursive: true });
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
      namespacedJoin(primaryDir, `${stamp}--${tag}--reverted.md`),
      lines.join("\n"),
      "utf8",
    );
  } catch (err) {
    ctx.log.warn(
      `[flume] ${tag}: revert note write failed: ${(err as Error).message}`,
    );
  }
}

/**
 * Classify a no-usable-commit-no-gate tick and persist the matching
 * prior-attempt record so the retry's prompt carries it. A clean agent exit that
 * produced nothing usable is a **clean-exit** — the record carries the tail of
 * the agent's final message, the span it produced nothing across, and nothing
 * about what the exit meant; a
 * **platform-preempt** otherwise — the non-work failure class, explicitly
 * not a defect in the work. Returns the mode for `TickOutcome` / the
 * logger record.
 */
async function classifyNoCommit(
  ctx: AttemptContext,
  ref: PriorAttemptRef,
  termination: AgentTermination,
  span: { spanBase: string; spanHead: string },
): Promise<NoCommitMode> {
  if (termination.kind === "clean") {
    await ctx.attempts.write(
      ref,
      buildCleanExit(termination.finalMessage, span),
    );
    return "clean-exit";
  }
  await ctx.attempts.write(
    ref,
    buildPlatformPreempt(termination.failureClass),
  );
  return "platform-preempt";
}

/**
 * Persist the fully rendered prompt before the agent runs (spec/prompt.md
 * "The rendered prompt is persisted before the agent runs") and return
 * its path relative to `flumeDir`, forward-slash, for the verdict's
 * invocation row. `key` is the same prior-attempt key the retry record
 * uses — the phase name for a singleton, the slugified tag for a fanout
 * entry — so the two records for one span share a name. The timestamp
 * keeps ticks apart; the key keeps a wave's entries apart. A write
 * failure propagates: a tick whose input record cannot be kept does not
 * spend an invocation (.claude/rules/engineering.md "Loud or nothing").
 */
async function recordRenderedPrompt(
  ctx: AttemptContext,
  key: string,
  prompt: string,
): Promise<string> {
  const dir = renderedPromptsDir(ctx.flumeDir);
  const name = `${fsStamp()}-${slugify(key)}.md`;
  await mkdir(namespacedJoin(dir), { recursive: true });
  await writeFile(namespacedJoin(dir, name), prompt, "utf8");
  return `${STATE_ROOT_NAMES.renderedPrompts}/${name}`;
}

/**
 * Persist the render-refused record and log it — the one
 * shared shape both the singleton and fanout render callsites route
 * through (.claude/rules/engineering.md "The fix lands at the mechanism"),
 * the same way {@link classifyNoCommit} above already centralizes the
 * no-commit persist+log.
 * Each callsite still builds its own return shape from here, matching how
 * `classifyNoCommit`'s two callers already differ. `label` is the
 * phase name (singleton) or entry tag (fanout) — whichever scope `key`
 * itself was derived from.
 */
async function persistRenderRefused(
  ctx: AttemptContext,
  ref: PriorAttemptRef,
  label: string,
  err: InlineExecRenderError,
): Promise<void> {
  await ctx.attempts.write(ref, buildRenderRefused(err.message));
  ctx.log.warn(
    `[flume] ${label}: render-refused (no commit): ${err.message}`,
  );
}

/**
 * A pre-invocation hook that threw, persisted the way the render's own
 * refusal is (`spec/chain.md`, *What a hook receives*): same
 * `render-refused` record, so the retry reads the hook and the frame that
 * raised instead of running blind against a seam it cannot see failed. The
 * caller supplies the no-commit outcome; this writes the record and says so
 * once, for both hooks and both concurrencies.
 *
 * One helper with two callers — `promptArgs` inside the attempt,
 * `shouldRun` at the consult that precedes it (`consultShouldRun`, below) —
 * beats the same record spelled twice (`.claude/rules/engineering.md`, *A
 * module is one job*).
 */
async function persistHookRefusal(
  ctx: AttemptContext,
  ref: PriorAttemptRef,
  label: string,
  hook: "shouldRun" | "promptArgs",
  err: unknown,
): Promise<void> {
  const { message, stack } = throwFacts(err);
  await ctx.attempts.write(
    ref,
    buildRenderRefused(
      `${hook} hook threw: ${message}${stack === undefined ? "" : `\n${stack}`}`,
    ),
  );
  ctx.log.warn(
    `[flume] ${label}: ${hook} threw: ${message}; render-refused (no commit)`,
  );
}

/**
 * `phase.shouldRun`, consulted for both concurrencies at one site — the
 * singleton leg before it provisions anything (`src/singletonTick.ts`), the
 * wave leg per entry (`src/waveTick.ts`); `.claude/rules/engineering.md`,
 * *The fix lands at the mechanism*, and `runGate` (`src/gateRun.ts`) is the
 * same shape one seam over. It sits here, beside the attempt it gates,
 * because its refusal record is the attempt's own — {@link
 * persistHookRefusal}, shared with the `promptArgs` consult rather than
 * spelled twice.
 *
 * Three answers, not two. A throw is **refused**, never `declined`: a hook
 * that could not decide has not decided to skip (`spec/chain.md`, *What a
 * hook receives*), so the caller takes its no-invocation refusal path and
 * the verdict never records a chain decision the chain never reached. An
 * absent hook runs, byte-identically to one that returned `true`.
 */
export async function consultShouldRun(
  ctx: AttemptContext,
  phase: Phase,
  tickCtx: TickContext,
  ref: PriorAttemptRef,
  label: string,
): Promise<"run" | "declined" | "refused"> {
  if (!phase.shouldRun) return "run";
  let verdict: boolean;
  try {
    verdict = phase.shouldRun(tickCtx);
  } catch (err) {
    await persistHookRefusal(ctx, ref, label, "shouldRun", err);
    return "refused";
  }
  if (verdict) return "run";
  ctx.log.info(`[flume] ${label}: declined (shouldRun) — no invocation`);
  return "declined";
}

/**
 * `phase.promptArgs`, called for both concurrencies at one site. A throw is
 * `render-refused` (`spec/chain.md`, *What a hook receives*): the prompt
 * never resolved, so the agent is never invoked and the record persisted is
 * the one any other render refusal leaves. An absent hook is an empty map,
 * exactly as before.
 */
async function resolvePromptArgs(
  ctx: AttemptContext,
  phase: Phase,
  tickCtx: TickContext,
  ref: PriorAttemptRef,
  label: string,
): Promise<{ ok: true; args: Record<string, string> } | { ok: false }> {
  try {
    return { ok: true, args: phase.promptArgs?.(tickCtx) ?? {} };
  } catch (err) {
    await persistHookRefusal(ctx, ref, label, "promptArgs", err);
    return { ok: false };
  }
}
