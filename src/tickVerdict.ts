/**
 * The tick verdict — the facts artifact every tick that runs a phase leaves
 * behind: its shape, the stage-failure and merge-fate vocabularies it
 * carries, and the read/write/clear I/O over the two files it lives in.
 *
 * spec/loop.md "The tick verdict — one facts artifact". The dispatcher
 * builds a verdict, the CLI writes it, `superviseLoop` and a chain's
 * `shouldRun`/`handoff` read it back: three surfaces on one shape, so the
 * shape and its I/O live in their own file rather than inside whichever of
 * them happens to construct it (`.claude/rules/engineering.md`, *A module is
 * one job*).
 *
 * The small constructors of those vocabularies live here too — the row a
 * gate's result becomes, the signature a stage failure is compared by, the
 * two facts a throw reports — because every producer spells them the same
 * way and a field decoded for one surface may not be dropped from the next.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";

import type { AgentUsage } from "./Agent.js";
import { bound } from "./bounds.js";
import { existsLoud } from "./fsProbe.js";
import type { GateResult } from "./Gate.js";
import {
  namespacedJoin,
  tickVerdictDir,
  tickVerdictPath,
  tickVerdictsLogPath,
} from "./paths.js";
import type { PidClaim } from "./pidClaim.js";
import type { NoCommitMode } from "./Prompt.js";

/**
/**
 * One pre-tick worktree provisioning failure — the
 * dispatcher never reached the agent for the affected entry (or, for a
 * repo-level failure, for any entry this tick).
 *
 * The exported name is pinned by `src/index.ts`'s barrel export and by
 * `tests/Dispatcher.test.ts`'s barrel-export pin, so it stays `ProvisionFailure`
 * — provision-stage only — even though {@link MergeFailure} and
 * {@link GateFailure} below now share its exact shape for the two stages
 * spec/loop.md's "Repeated identical failures" generalized the backstop to.
 */
export type ProvisionFailure = StageFailureEntry & {
  /**
   * Comparable signature — the same deterministic wall (e.g. the same held
   * directory) yields the same signature tick over tick, letting the
   * consecutive-failure backstop recognize a repeat without diffing full
   * error text.
   */
  signature: string;
  /** Full error message, for the quarantine/abort log lines. */
  message: string;
};

/**
 * Which entry a stage failure is blamed on — **both halves or neither**, so
 * the supervisor's quarantine leg can never read a tag it has no key to
 * hold it under (`.claude/rules/engineering.md`, *Narration is the ladder's
 * bottom rung*: the pairing is a type, not a comment asking each call site
 * to remember).
 *
 * - `tag` is the entry the failure is scoped to (a `createWorktree` failure
 *   for that specific slug, a cherry-pick conflict on that entry's commit, a
 *   gate revert of it). Absent for a repo-level failure (e.g. `git worktree
 *   prune`), for a singleton phase's own revert, and for a gate revert whose
 *   gate declared `blamesSpan: false` (`./Gate.js`) — in each, no single
 *   entry can be blamed. The run-scoped quarantine only ever isolates a
 *   *blamed* failure; an unblamed one is exactly the "non-entry-scoped"
 *   class the consecutive-failure backstop exists for.
 * - `quarantineKey` is that entry's key **as this tick read it** from
 *   its queue file (`entryDeclaredKey`, `src/entryKey.ts`), the value the
 *   supervisor holds the quarantine under and crosses to the next child on
 *   `FLUME_QUARANTINED_SLUGS`. Reported rather than recomputed: the
 *   supervisor holds only the verdict, and a second read of the queue
 *   there would key the hold on bytes a *later* tick wrote
 *   (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 *   never rediscovered*).
 */
export type StageFailureEntry =
  | { tag: string; quarantineKey: string }
  | { tag?: undefined; quarantineKey?: undefined };

/**
 * A merge-stage failure (spec/loop.md "Repeated identical failures — quarantine,
 * then abort"): a cherry-pick conflict, or a dirty trunk refusing the pick, that
 * kept a worktree's already-agent-committed work off trunk. `tag` is the
 * fanout entry's tag; absent for a singleton phase's own merge-stage failure
 * (no entry to quarantine — same rationale as {@link StageFailureEntry}, it
 * falls to the consecutive-failure backstop alone).
 */
export type MergeFailure = StageFailureEntry & {
  /** Same comparison-key contract as `ProvisionFailure.signature`. */
  signature: string;
  message: string;
};

/**
 * One entry a fanout wave selected and then did not carry: between the wave's
 * claims read and its own stake, a sibling tick took the entry's claim
 * (`spec/pending.md`, *Claims — an entry in flight is left alone*). The entry
 * is untouched in the queue, reached no agent, and is being built by the
 * holder named here.
 *
 * Not a {@link ProvisionFailure}: losing the race is neither a failure nor
 * this wave's fault, and the run quarantine those records feed must not hold
 * an entry a sibling is shipping right now.
 *
 * A fact, never a verdict — whether to wake the phase again, wait for the
 * holder, or let the next tick pick the entry up stays the chain's
 * (`.claude/rules/engine-boundary.md`, *Routing rule (plan, build, and
 * interactive sessions)*).
 */
export interface StakeLoss {
  /** The entry this wave selected and left to its holder, by tag. */
  tag: string;
  /**
   * The live holder the stake found, as the holder itself stated it in the
   * claim file (`PidClaim`, `src/pidClaim.ts`) — the engine's own decode,
   * handed on rather than left for a reader to re-read the claims directory
   * for (`.claude/rules/engineering.md`, *A fact the engine holds is
   * reported, never rediscovered*).
   */
  by: PidClaim;
}

/**
 * A gate-stage failure (spec/loop.md "Repeated identical failures — quarantine,
 * then abort"): an afterCommit or afterMerge gate that reverted a commit,
 * `signature` derived from the gate's own name plus its failure output. `tag`
 * is absent for a singleton phase's own gate revert (no entry to quarantine —
 * it falls to the consecutive-failure backstop alone) and for a fanout entry
 * whose gate declared `blamesSpan: false` (`./Gate.js`), and present for
 * every other fanout entry/wave gate revert.
 */
export type GateFailure = StageFailureEntry & {
  /** Same comparison-key contract as `ProvisionFailure.signature`. */
  signature: string;
  message: string;
};

/**
 * One gate's result as the engine reports it — the single row shape every
 * reporting surface carries: a {@link TickVerdict}'s `gateResults` on disk,
 * `TickResult.gateResults` for `handoff`, and `ShipContext.gateResults` for
 * `shipped` (`./Phase.js`, spec/chain.md "What a hook receives"). One shape,
 * so a hook reads the same fields a verdict reader does and never
 * pattern-matches `message` for a discriminant its own chain authored
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). It doubles as the local accumulator the gate loops
 * push into: the fields are mutable, so nothing widens or narrows on the way
 * out.
 */
export interface ReportedGateResult {
  gate: string;
  ok: boolean;
  message: string;
  /**
   * The gate's own `GateResult.details` (`./Gate.js`), copied verbatim — the
   * long-form evidence behind `message`: for a failing writable-paths gate
   * that is the actual list of violating paths, never a re-derived summary.
   * Absent when the gate offered none.
   */
  details?: string;
  /**
   * The gate's own `GateResult.verdict` (`./Gate.js`), copied verbatim — the
   * chain-authored discriminant for *why* the gate ruled as it did. Absent
   * when the gate authored none. Copied, never interpreted: a chain reading
   * a persisted verdict keys on this field instead of pattern-matching its
   * own prose back out of `message` (spec/chain.md "What a gate returns").
   */
  verdict?: string;
  /**
   * The gate's own `GateResult.skipped` (`./Gate.js`), copied verbatim: `ok`
   * was not earned by running a judge, and the gate said why. Absent means
   * the gate claims it ran. Copied, never interpreted — a verdict reader
   * tells a passed gate from one that never ran without pattern-matching
   * `message` (spec/chain.md "What a gate returns").
   */
  skipped?: string;
  /**
   * The gate's own `GateResult.failingFiles` (`./Gate.js`), copied verbatim:
   * the repo-relative paths the gate attributed the failure to. Absent when
   * the gate named none. The engine derives nothing from it, so a chain
   * reading the verdict or a `handoff` reads the same list instead of
   * re-parsing the gate's output beside it (`.claude/rules/engineering.md`,
   * *A fact the engine holds is reported, never rediscovered*).
   */
  failingFiles?: string[];
  /**
   * The gate's own `GateResult.blamesSpan` (`./Gate.js`), copied verbatim:
   * present and `false` when the gate disowned the gated span for this
   * failure. The engine *does* act on it — it withholds the entry-scoped
   * half of the stage failure (`StageFailureEntry` above) and stamps the
   * `gate-revert` record with the same declaration — and reports it here
   * beside the fields it only copies, so a `handoff` or a `shouldRun`
   * reads the attribution the engine acted on rather than re-deriving it
   * from the gate's prose (`.claude/rules/engineering.md`, *A fact the
   * engine holds is reported, never rediscovered*).
   */
  blamesSpan?: false;
}

/** Bound on a persisted stage-failure signature (provision/merge/gate alike) — a comparison key, not a transcript. */
export const MAX_FAILURE_SIGNATURE = 500;

/**
 * {@link GateFailure.signature}: derived from the gate's own name plus its
 * failure output, so two different gates failing with the same message text
 * (or the same gate failing with two different messages) never collide.
 */
export function gateFailureSignature(failure: {
  gate: string;
  message: string;
}): string {
  return bound(
    `${failure.gate}: ${failure.message}`.trim(),
    MAX_FAILURE_SIGNATURE,
  );
}

/**
 * What a throw reports: the message it raised and, when it has one, the stack
 * that raised it. Every seam that answers a throw with a record rather than
 * losing the tick reads it here — a gate's `{ message, details }`
 * (`spec/chain.md`, *What a gate returns*) and a hook's render-refused record
 * (*What a hook receives*) are the same two facts under two names, so the
 * decoding is shared rather than re-derived beside each one
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * `stack` is absent rather than a second copy of `message` when the thrown
 * value has none — a non-`Error`, or an `Error` whose `stack` was stripped —
 * because a duplicated line reads as evidence while carrying none
 * (*Derived state is computed, never restated beside its source*).
 */
export function throwFacts(err: unknown): { message: string; stack?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error && typeof err.stack === "string" && err.stack
      ? err.stack
      : undefined;
  return stack ? { message, stack } : { message };
}

/**
 * The one construction of a {@link ReportedGateResult} from the
 * {@link GateResult} a gate just returned. Every reporting surface — the
 * afterCommit loop, both afterMerge loops, and the failure record each hands
 * to `buildGateRevert` — reads the row from here, so a field the engine
 * decodes cannot reach one surface and be dropped from the next
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Optional fields ride only when the gate authored them: `exactOptionalPropertyTypes`
 * makes an explicit `undefined` a different shape from absence, and absence is
 * what "the gate said nothing" means on disk.
 */
export function reportedGateRow(
  gate: string,
  r: GateResult,
): ReportedGateResult {
  return {
    gate,
    ok: r.ok,
    message: r.message,
    ...(r.details ? { details: r.details } : {}),
    ...(r.verdict ? { verdict: r.verdict } : {}),
    ...(r.skipped ? { skipped: r.skipped } : {}),
    ...(r.failingFiles ? { failingFiles: r.failingFiles } : {}),
    // `=== false` rather than truthiness: the field's one meaningful value
    // is the falsy one, so the usual `r.x ? … : {}` idiom beside it would
    // drop exactly the declaration this row exists to carry.
    ...(r.blamesSpan === false ? { blamesSpan: false as const } : {}),
  };
}

/**
 * How a fanout entry's landed worktree commit fared once the wave tried to
 * put it on trunk:
 *  - `merged`                cherry-picked, passed every afterMerge gate,
 *                            and the agent's own termination never stated a
 *                            park — counted shipped.
 *  - `cherry-pick-conflict`  the cherry-pick itself failed; entry stays
 *                            pending, no commit reached trunk.
 *  - `afterMerge-reverted`   landed, then an afterMerge gate failed; that
 *                            entry's commit alone was reset back off trunk.
 *  - `afterMerge-revert-refused` landed, an afterMerge gate failed, and the
 *                            `reset --keep` that would have carried the
 *                            commit back off trunk was itself refused — a
 *                            bystander's uncommitted work collides with the
 *                            paths the revert needs to touch (spec/loop.md
 *                            "Tip verify", "dropping it must not take
 *                            bystanders"). The commit stays on trunk, unlike
 *                            `afterMerge-reverted`; the entry stays pending
 *                            regardless, so it is never counted shipped. The
 *                            bounded exception to absorption the same
 *                            section names for a mid-history refusal —
 *                            evidence left for the operator rather than a
 *                            forced wipe.
 *  - `afterCommit-reverted`  reverted inside the worktree by an afterCommit
 *                            gate; never reached
 *                            cherry-pick, so it never touched trunk on its
 *                            own.
 *  - `not-shipped`           landed and passed every gate, but the phase's own
 *                            `shipped` predicate returned false
 *                            (spec/pending.md "Ship detection trusts the
 *                            agent's own account") — commit stays on trunk,
 *                            entry stays pending. The engine records the
 *                            chain's verdict and holds no vocabulary for its
 *                            reason.
 *  - `tip-moved`             the wave's own commit-onto-trunk step refused
 *                            because a live claim held the ref (a concurrent
 *                            engine instance, spec/loop.md "Tip verify") —
 *                            never reached cherry-pick, entry stays pending
 *                            for a fresh retry once the claim clears. A
 *                            foreign non-engine commit on the ref, with no
 *                            live claim, is absorbed instead: git's own
 *                            conflict detection is the only content arbiter.
 *  - `dropped-work`          the per-entry tip-verify leg's own ancestry
 *                            check refused (spec/loop.md "Tip verify",
 *                            per-entry leg): this entry's worktree commit
 *                            was soft-reset because its recorded base was no
 *                            longer an ancestor of the observed HEAD — never
 *                            reached cherry-pick either, but distinct from
 *                            `tip-moved` above, which is the *shared trunk*
 *                            racing during this wave's own merge step. A
 *                            sibling fact so a dropped per-entry commit
 *                            never lands as silence a partial ship summary
 *                            papers over.
 */
export type MergeOutcome =
  | "merged"
  | "cherry-pick-conflict"
  | "afterMerge-reverted"
  | "afterMerge-revert-refused"
  | "afterCommit-reverted"
  | "not-shipped"
  | "tip-moved"
  | "dropped-work";

/**
 * One provisioned span's {@link MergeOutcome}, as recorded in a {@link
 * TickVerdict} — per entry under fanout, the phase's own single span under
 * singleton. `footprint` is the span's actual touched paths — present
 * on the outcomes that never landed cleanly on trunk (`cherry-pick-conflict`,
 * `afterMerge-reverted`, `afterCommit-reverted`) where a captured diff
 * exists; absent when the outcome carries no footprint of its own (`merged`,
 * `not-shipped`, or a best-effort capture that failed). `commitPendingUpdate`
 * sources a wave's footprint commit from this same field — the same verdict
 * record, never a separate capture, so there is no
 * independently-maintained observed-files map.
 */
export interface TickVerdictMergeOutcome {
  /**
   * The fanout entry this span belongs to. Absent on a singleton phase's own
   * span, which has no entry to tag — the verdict's `phaseName` already names
   * it, and restating it here would invent a tag naming no queue entry (same
   * shape as {@link TickVerdictInvocation.entryTag}, and the same name).
   */
  entryTag?: string;
  outcome: MergeOutcome;
  footprint?: string[];
  /**
   * The base `headSha` is reachable from, so `baseSha..headSha` is exactly
   * this span and nothing adjacent. Pairs with whichever sha `headSha` holds:
   * the pre-cherry-pick trunk tip for a span that reached trunk (`merged`,
   * `afterMerge-reverted`, `afterMerge-revert-refused`, `not-shipped`), else
   * the tip the agent's worktree branched from (`tip-moved`, `dropped-work`,
   * `afterCommit-reverted`, `cherry-pick-conflict`). Recovery needs both: a
   * span may hold several commits (spec/loop.md "N commits are completion"),
   * and `headSha` alone re-picks only the last of them. Absent only when the
   * span never reached a commit at all.
   */
  baseSha?: string;
  /**
   * The span's own head — the entry's cherry-picked commit sha once one
   * exists (`merged`, `afterMerge-reverted`, `not-shipped`), else the
   * worktree-branch commit sha the entry never got past (`tip-moved`,
   * `dropped-work`, `afterCommit-reverted`). Recovery, not decoration: a span
   * parked or refused after its gates passed must be re-cherry-pickable from
   * the verdict alone, never re-run at full agent price — worktree teardown
   * deletes the branch, but the commit object survives in the shared store
   * until gc, and this is the only place its sha outlives the branch. Absent
   * only when the entry never reached a commit at all.
   */
  headSha?: string;
  /**
   * The message a `shipped` predicate *threw* instead of returning
   * (`spec/chain.md`, *What a hook receives*: a throw is not `false`). Only a
   * `not-shipped` outcome carries it, and only when a throw produced that
   * outcome — absent when the predicate deliberately returned `false`, so a
   * chain reading the verdict tells a declined ship from a broken predicate
   * without the two collapsing into one record.
   */
  threw?: string;
}

/**
 * spec/loop.md "The tick verdict — one facts artifact", "Every agent
 * invocation leaves a usage row": one row per agent run this tick, carrying
 * whatever cost/usage facts that run's `AgentResult` (`src/Agent.ts`)
 * reported. `entryTag` names the provisioned entry under fanout — the same
 * name and rule as `AgentInvocation.entryTag` (`src/Agent.ts`); absent for a
 * singleton phase, which has no entry to tag.
 */
export interface TickVerdictInvocation extends AgentUsage {
  entryTag?: string;
  /**
   * spec/prompt.md "The rendered prompt is persisted before the agent runs":
   * the file holding the prompt this invocation was handed, byte for byte,
   * as a forward-slash path relative to `flumeDir`. Written before
   * `agent.invoke`, so a row exists iff the file does — the read-side record
   * beside the write fence, and the one place "what was this tick told"
   * is answerable without re-rendering.
   */
  promptPath: string;
  /**
   * spec/loop.md "Tip verify": the tracked paths this run left dirty in its
   * worktree — modified and not committed — read while the worktree still
   * existed, immediately before teardown removes it and them. Covers the
   * agent's own leftovers and the content a soft-reset span (a tip-verify
   * refusal, an `afterCommit` gate revert) put back into the tree, whichever
   * the tick produced.
   *
   * Always present on a row, `[]` when the tick left nothing behind: "the
   * loss is seen even though it is not preserved" is only readable if the
   * no-loss case is stated too, and an absent key would make a clean
   * teardown indistinguishable from a read that never happened. Untracked
   * files are out of scope (`trackedModifications` (`src/git.ts`)).
   *
   * A fact, never a verdict: the engine says what went away with the
   * worktree; whether that matters is the chain's
   * (`.claude/rules/engine-boundary.md`).
   */
  uncommittedTracked: string[];
}

/**
 * Every {@link AgentUsage} fact that is a number, and so summable across
 * rows. Derived from the shape rather than listed beside it: a usage field
 * added there joins this union, and {@link totalAgentUsage}'s return literal
 * stops compiling until it is summed too.
 */
type SummableUsageKey = {
  [K in keyof AgentUsage]-?: NonNullable<AgentUsage[K]> extends number
    ? K
    : never;
}[keyof AgentUsage];

/**
 * A set of {@link TickVerdictInvocation} rows summed — what some span of
 * agent runs reported, in the units the rows report them in. Module-internal:
 * every consumer outside this file groups by phase, so what they hold is
 * {@link PhaseAgentUsage} and this is the shape it is built from
 * (`.claude/rules/engineering.md`, *An export earns its consumer*). Every field is
 * a total rather than an optional fact: a row that omitted one contributed
 * zero to it, and an empty set totals zero across the board.
 *
 * `model` is absent by construction ({@link SummableUsageKey}) — a model id
 * does not add, and naming "the" model of a mixed set would invent a fact no
 * row states, the same reason a row omits it when the invocation named more
 * than one.
 */
type AgentUsageTotals = Record<SummableUsageKey, number> & {
  /** How many rows were summed — one per agent run. */
  invocations: number;
};

/**
 * Sum `rows` into `into` — an empty total by default — and return the new
 * total. Pure, and accumulating: a caller folding a run's ticks together
 * hands back the total it already holds, so there is one adder rather than a
 * second one beside it for the across-ticks case.
 *
 * Beside the rows it reads: the fields summed here are
 * {@link TickVerdictInvocation}'s, so a decode that starts reporting one
 * more of them is totalled here or reported nowhere.
 */
function totalAgentUsage(
  rows: readonly TickVerdictInvocation[],
  into: AgentUsageTotals = {
    invocations: 0,
    turns: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0,
  },
): AgentUsageTotals {
  const sum = (
    read: (row: TickVerdictInvocation) => number | undefined,
    base: number,
  ): number => rows.reduce((total, row) => total + (read(row) ?? 0), base);
  return {
    invocations: into.invocations + rows.length,
    turns: sum((r) => r.turns, into.turns),
    durationMs: sum((r) => r.durationMs, into.durationMs),
    inputTokens: sum((r) => r.inputTokens, into.inputTokens),
    outputTokens: sum((r) => r.outputTokens, into.outputTokens),
    cacheCreationInputTokens: sum(
      (r) => r.cacheCreationInputTokens,
      into.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: sum(
      (r) => r.cacheReadInputTokens,
      into.cacheReadInputTokens,
    ),
    costUsd: sum((r) => r.costUsd, into.costUsd),
  };
}

/**
 * One phase's share of some span of agent spend: every usage row that span's
 * ticks of that phase wrote, summed. `phase` is the verdict's own
 * `phaseName` ({@link TickVerdict}) — grouped by what each tick reported,
 * never by what something spawned.
 */
export interface PhaseAgentUsage extends AgentUsageTotals {
  phase: string;
}

/**
 * Fold `verdicts` into one total per phase, in the order each phase first
 * invoked an agent. A phase appears only once a verdict of its own carried a
 * row, so "nothing was spent" and "nothing ran" read the same because they
 * are, and a span whose ticks invoked nothing totals to an empty list rather
 * than a roster at zero.
 *
 * One grouping for every span of rows: `superviseLoop`
 * (`src/loopSupervisor.ts`) folds the run it just supervised, `flume status`
 * folds what the live run has written so far, and neither respells the
 * grouping beside the other (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*). Which rows are in the span is the caller's — the
 * supervisor holds its own children's verdicts, `status` bounds the log by
 * when the run claimed the lock.
 */
export function totalAgentUsageByPhase(
  verdicts: readonly TickVerdict[],
): PhaseAgentUsage[] {
  const byPhase = new Map<string, AgentUsageTotals>();
  for (const verdict of verdicts) {
    // Guarded on a non-empty row list rather than folded unconditionally:
    // `totalAgentUsage` over zero rows is a no-op on the numbers, but seeding
    // the map would put a phase that invoked nothing into the result at zero
    // spend.
    if (verdict.invocations.length === 0) continue;
    byPhase.set(
      verdict.phaseName,
      totalAgentUsage(verdict.invocations, byPhase.get(verdict.phaseName)),
    );
  }
  return [...byPhase].map(([phase, totals]) => ({ phase, ...totals }));
}

/**
 * The one facts artifact every tick that actually runs a phase writes —
 * phase, entry tag(s), committed/no-commit class, gate results, shipped
 * tags, and (fanout) each provisioned entry's cherry-pick/merge fate. The
 * only such channel: no counts file, no footprint-only capture, and no
 * in-process-only `TickResult.noCommit` beside it.
 *
 * No interpretation fields: this is what happened, never what it means —
 * "park", "bail worth waking for" are a chain's own readings, not engine
 * vocabulary. `errored` (the run-level failure classification) is
 * deliberately absent from this shape for the same reason: `superviseLoop`
 * derives it from the facts below at the read site (see its call to {@link
 * readTickVerdict}) rather than storing a precomputed judgment on disk.
 */
export interface TickVerdict {
  phaseName: string;
  /**
   * Entry tags this tick provisioned a worktree/agent for; empty for a
   * singleton phase or a fanout wave with nothing pickable.
   */
  tags: string[];
  committed: boolean;
  /**
   * No-commit classification, present iff the tick (or, for
   * a fanout wave, the whole wave) produced no usable commit. Absent on a
   * committed tick or a nothing-pickable no-op (no agent ran).
   */
  noCommit?: NoCommitMode;
  /**
   * Set when this tick (or, for a fanout wave, any part of
   * it) hit the tip-verify backstop and refused a commit. Two producers,
   * and neither compares the ref against a tip recorded at tick start:
   *
   *  - before every harness-driven commit — each cherry-pick and the
   *    trailing pending-ledger commit — a **live foreign claim** on the ref,
   *    which is a second engine instance interleaving merges. An unclaimed
   *    foreign commit is absorbed instead: the pick lands onto whatever tip
   *    is current and git's conflict detection arbitrates content.
   *  - on the agent's own private `flume/**` branch, a **recorded base that
   *    is no longer an ancestor** of the HEAD the agent left — something
   *    reset or rewrote the branch out from under it. Committing twice on
   *    that branch is a completed tick, not interference, so the check is
   *    ancestry rather than equality.
   *
   * A sibling fact to `noCommit`, never folded into it: the cause here is
   * never one of the four `NoCommitMode` classes, and a wave can carry both
   * (some entries shipped before the refusal, the rest refused) or
   * `tipMoved` alone with `committed: true` (every entry that reached
   * cherry-pick shipped; only the trailing pending-ledger commit refused).
   * Absent when nothing this tick touched hit the backstop.
   */
  tipMoved?: boolean;
  /**
   * Set when this tick (or, for a fanout wave, any part
   * of it) never invoked the agent because `phase.shouldRun` returned
   * `false` — a sibling fact to `noCommit`/`tipMoved`, never a fifth
   * `NoCommitMode`: the chain declined the tick outright, which is not one
   * of the four causally-distinct no-commit classes (no agent ran, so
   * nothing to classify) and not the tip-verify backstop (nothing raced).
   * A wave can carry both `declined` and `shippedTags`/`committed: true`
   * (one entry declined while its siblings ran and shipped) or `declined`
   * alone with `committed: false` (every provisioned entry declined).
   * Absent when nothing this tick touched hit a `shouldRun` refusal.
   */
  declined?: boolean;
  /**
   * spec/loop.md "Crash equals stop": the sha of a dangling commit
   * (`git stash create`'s shape — object written, no ref moved, nothing
   * reset) capturing whatever was staged or unstaged on the primary
   * checkout when this tick's merge stage began, checkpointed before the
   * tick's first cherry-pick range so a later `--abort` or gate revert can
   * never destroy the operator's own bystander work unrecoverably. Absent
   * when the tree was clean at that point, or when the tick's merge stage
   * never began (nothing committed to cherry-pick).
   */
  bystanderCheckpointSha?: string;
  /** Every gate that ran this tick, in run order, across every entry. */
  gateResults: ReportedGateResult[];
  /** Entry tags shipped by this tick (entries the phase's `shipped` predicate rejected already excluded); empty for a singleton phase. */
  shippedTags: string[];
  /**
   * One row per provisioned span that reached a merge fate. Which spans those
   * are is {@link TickVerdictMergeOutcome}'s own doc to state. Empty when no
   * span reached a fate this tick — nothing provisioned, or every span stopped
   * short of one (declined, render-refused, or no commit to cherry-pick).
   */
  mergeOutcomes: TickVerdictMergeOutcome[];
  /**
   * spec/loop.md "The tick verdict", "Every agent invocation leaves a usage
   * row": one entry per agent run this tick — one for a singleton, one per
   * provisioned entry that actually reached `invokeAgent` under fanout.
   * Empty when nothing this tick invoked the agent at all (declined,
   * render-refused, or nothing pickable).
   */
  invocations: TickVerdictInvocation[];
  /**
   * Pre-tick worktree provisioning failures (sweep or
   * create) this tick recorded, before any agent ran for the affected
   * entries. Absent/empty when the tick hit none.
   */
  provisionFailures?: ProvisionFailure[];
  /**
   * spec/pending.md "Claims — an entry in flight is left alone": every entry
   * this tick selected and then lost the stake race for, each naming the
   * holder that took it. Absent/empty when every selected entry was staked —
   * which is every tick with no sibling racing it.
   */
  stakeLosses?: StakeLoss[];
  /**
   * Merge-stage cherry-pick-conflict failures this tick recorded
   * (spec/loop.md "Repeated identical failures").
   * Absent/empty when the tick hit none.
   */
  mergeFailures?: MergeFailure[];
  /**
   * Gate-stage failures — an afterCommit
   * or afterMerge gate revert — this tick recorded. Absent/empty when the
   * tick hit none.
   */
  gateFailures?: GateFailure[];
  /**
   * spec/loop.md "No false signal": prior-attempt records this tick cleared
   * as stale — entry-keyed records whose tag the queue the wave read no
   * longer carries — by the key each was filed under. The retry those
   * records were written for will never happen, so the wave that observes
   * the tag's absence is what retires them, and says which. Absent/empty
   * when the wave found none, and on a singleton tick, which selects no
   * entries from the queue.
   */
  clearedPriorAttempts?: string[];
  /** This tick's one-line logger summary, verbatim — a rendering of the facts above, not a judgment of them. */
  summary: string;
  /**
   * spec/loop.md "The tick verdict — one facts artifact": the trunk repo's
   * HEAD at the moment this verdict was built — after this tick's own
   * commits, if any, already landed. "Has the world moved since this phase
   * last ran" is therefore a comparison against this field, never an
   * inference from which paths the last commit touched, and a quiet
   * (no-commit) tick still leaves an anchor behind: a phase need not commit
   * just to record one.
   */
  headSha: string;
  /**
   * ISO timestamp alongside {@link headSha}, written when the verdict was
   * built. Load-bearing for one reader: `flume status` bounds the live run's
   * spend to the rows this field dates at or after the instant that run's
   * `loop.pid` *states* it took the lock — the supervisor's own second line,
   * never the lock file's mtime (spec/cli.md, "`flume status` owes exactly
   * this"; spec/loop.md, "The loop lock and the tip claim"). Both ends of
   * that comparison are therefore a statement its writer made, so a row is
   * in a run's window by what the two say rather than by where the row sits
   * in the log or by what a backup tool last touched. Ambient context to
   * every other reader.
   */
  at: string;
}

/**
 * Two files under the state dir, both stable paths, neither a
 * dogfood convention. Their names live in `STATE_ROOT_NAMES`
 * (`src/paths.ts`) with the rest of the state root's layout, so the job
 * `.gitignore` seed carries them without a second spelling; the accessors
 * are re-exported here, where what each file carries is defined:
 *  - {@link tickVerdictPath} — this tick's verdict alone, one file per phase
 *    under {@link tickVerdictDir}, overwritten
 *    every real `flume tick` process of that phase (the CLI's `tick` command writes it,
 *    from the `TickVerdict` its own `dispatcher.tick()` call returned —
 *    never `Dispatcher.tick()` itself, which plain unit tests call directly
 *    and must not gain an untracked side effect underfoot). `clearTickVerdict`
 *    removes it before that same tick's own work begins, so a tick that
 *    never reaches the write (chain-load failure, hibernation, terminal
 *    misconfiguration) leaves nothing for `superviseLoop` to misread as its
 *    own. Per phase because a supervisor run holds one child per awake phase
 *    at once: on a single path the second child to finish overwrote the
 *    first's facts before the supervisor read them, and the loss was silent —
 *    the reader saw a well-formed verdict, just not the one it was waiting
 *    for. The supervisor names each child's phase on the way in, so it opens
 *    the file it named the child by.
 *  - {@link tickVerdictsLogPath} — every verdict ever written, appended
 *    and bounded to {@link MAX_TICK_VERDICTS}, read back by the exported
 *    `readTickVerdicts` accessor so a chain can render recent tick history
 *    into a prompt. Never cleared — it is history, not a per-tick signal.
 */
export { tickVerdictDir, tickVerdictPath, tickVerdictsLogPath };

/** Bound on {@link tickVerdictsLogPath}'s file — a rolling window, not an unbounded log. */
const MAX_TICK_VERDICTS = 200;

/** Structural check a parsed JSON value is shaped like a {@link TickVerdict} — corrupt or partial input degrades to "not a verdict", never a thrown parse error surfacing as a tick failure. */
function isTickVerdict(rec: unknown): rec is TickVerdict {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as Partial<TickVerdict>;
  return (
    typeof r.phaseName === "string" &&
    typeof r.committed === "boolean" &&
    Array.isArray(r.tags) &&
    Array.isArray(r.gateResults) &&
    Array.isArray(r.shippedTags) &&
    Array.isArray(r.mergeOutcomes) &&
    Array.isArray(r.invocations) &&
    typeof r.summary === "string" &&
    typeof r.headSha === "string" &&
    typeof r.at === "string"
  );
}

/**
 * The history log was present and unreadable when a tick went to record its
 * own verdict — the one failure {@link writeTickVerdict} reports as a class
 * of its own rather than letting escape as a bare I/O throw.
 *
 * A class because the caller's answer to it is an exit code, not a stack:
 * `flume tick` maps it to `EX_IOERR` at the process boundary (spec/loop.md,
 * *Exit codes — the run never lies to CI*), and a thrown type is what lets
 * that mapping read a statement instead of pattern-matching an errno's prose
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). Every other
 * failure out of that call — the state root's mkdir, either write — stays an
 * ordinary throw and reaches the harness-error exit, because neither is a
 * file that was read.
 *
 * Thrown only past the latest-tick write, so a caller holding one has a tick
 * whose work already landed and whose outcome it has already reported; what
 * failed is the recording.
 */
export class VerdictHistoryUnreadableError extends Error {
  /** The history log the read refused on, resolved. */
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = "VerdictHistoryUnreadableError";
    this.path = path;
  }
}

/**
 * Write this tick's verdict: overwrite the latest-tick file `superviseLoop`
 * reads between iterations, and append the same record to the bounded
 * history log the exported `readTickVerdicts` accessor serves. Called by
 * the CLI's `tick` command, once per real process, from the `TickVerdict`
 * its own `dispatcher.tick()` call returned.
 *
 * Throws {@link VerdictHistoryUnreadableError} when the history read below
 * refuses — the append cannot proceed over a log it never resolved, and
 * treating the refusal as an empty history would overwrite every record the
 * file holds with this one (`readTickVerdicts`, below).
 */
export async function writeTickVerdict(
  flumeDir: string,
  verdict: TickVerdict,
): Promise<void> {
  // The verdict dir nests inside the state root, so one recursive mkdir
  // creates both — and the history log below is written straight under
  // `flumeDir`. win32 MAX_PATH: flumeDir nests under a job/worktree root;
  // namespacedJoin (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(tickVerdictDir(flumeDir)), { recursive: true });
  // The phase is read off the verdict rather than taken as a second argument:
  // the record already states which phase produced it, and a caller passing
  // that name again is a fact restated beside its source
  // (`.claude/rules/engineering.md`, *Derived state is computed, never
  // restated beside its source*).
  await writeFile(
    namespacedJoin(tickVerdictPath(flumeDir, verdict.phaseName)),
    JSON.stringify(verdict),
    "utf8",
  );
  let history: TickVerdict[];
  try {
    history = await readTickVerdicts(flumeDir);
  } catch (err) {
    throw new VerdictHistoryUnreadableError(tickVerdictsLogPath(flumeDir), err);
  }
  const bounded = [...history, verdict].slice(-MAX_TICK_VERDICTS);
  await writeFile(
    namespacedJoin(tickVerdictsLogPath(flumeDir)),
    bounded.map((v) => JSON.stringify(v)).join("\n") + "\n",
    "utf8",
  );
}

/**
 * Clear a stale latest-tick verdict before a tick's own work — called by
 * the CLI's `tick` command before invoking `dispatcher.tick()`. Leaves the
 * history log untouched: clearing is a per-tick-signal concern, not a
 * history one.
 *
 * `phase` is the name the tick was invoked under, and clears that phase's
 * file alone — every supervisor child carries one (`flume tick --phase
 * <name>`), so a child never clears a sibling's verdict out from under the
 * supervisor. A bare `flume tick`, which chooses its phase from the baton
 * after this call and so cannot name one yet, clears the whole directory
 * instead: it takes the tip claim for itself, so no sibling child of its own
 * run exists to lose a verdict.
 */
export async function clearTickVerdict(
  flumeDir: string,
  phase?: string,
): Promise<void> {
  if (phase === undefined) {
    await rm(namespacedJoin(tickVerdictDir(flumeDir)), {
      force: true,
      recursive: true,
    });
    return;
  }
  await rm(namespacedJoin(tickVerdictPath(flumeDir, phase)), { force: true });
}

/**
 * Read `phase`'s last-written verdict, if any — consulted by `superviseLoop`
 * (`src/loopSupervisor.ts`), this export's only consumer, between child
 * ticks, with the phase it named the child by. Corrupt or absent (the CLI clears it before every
 * tick and writes it only once that tick's `dispatcher.tick()` call has
 * returned) degrades to "nothing to report" — a missing record must never
 * be misread as a prior tick's stale one.
 *
 * Absent is the only silent reading, and it is **proven**: `existsLoud`
 * (`src/fsProbe.ts`) throws on any stat failure but `ENOENT`, and the read
 * past it carries no catch of its own, so a verdict file that is present
 * and unreadable — a directory in its place, a permission-denied parent, a
 * symlink loop — refuses here instead of reporting the tick that wrote it
 * as one that left nothing behind (`.claude/rules/engineering.md`, *Loud or
 * nothing*). The degrade that remains is the parse alone, which is a
 * statement about the file's *contents*, not about whether it was read.
 */
export async function readTickVerdict(
  flumeDir: string,
  phase: string,
): Promise<TickVerdict | undefined> {
  const p = namespacedJoin(tickVerdictPath(flumeDir, phase));
  if (!existsLoud(p)) return undefined;
  const raw = await readFile(p, "utf8");
  try {
    const rec: unknown = JSON.parse(raw);
    return isTickVerdict(rec) ? rec : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read up to the last `n` verdicts (oldest first), for a chain to render
 * recent tick history into a prompt. Corrupt lines are skipped,
 * never thrown; an absent log reads as empty history — same no-false-signal
 * posture as every other artifact the harness persists.
 *
 * Absent, and nothing else: `existsLoud` (`src/fsProbe.ts`) proves it and
 * the read past it carries no catch, so a history log that is present and
 * unreadable refuses rather than answering "no history" — the one answer
 * that is indistinguishable from a repo that has never ticked
 * (`.claude/rules/engineering.md`, *Loud or nothing*). `flume log`,
 * `flume status` and `flume tick` each classify that refusal as `EX_IOERR`
 * (spec/cli.md; spec/loop.md, *Exit codes — the run never lies to CI*);
 * `writeTickVerdict` above re-throws it as
 * {@link VerdictHistoryUnreadableError} rather than reading the log as
 * empty, which would overwrite the whole history with this one record.
 */
export async function readTickVerdicts(
  flumeDir: string,
  n: number = MAX_TICK_VERDICTS,
): Promise<TickVerdict[]> {
  const p = namespacedJoin(tickVerdictsLogPath(flumeDir));
  if (!existsLoud(p)) return [];
  const raw = await readFile(p, "utf8");
  const verdicts: TickVerdict[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec: unknown = JSON.parse(trimmed);
      if (isTickVerdict(rec)) verdicts.push(rec);
    } catch {
      // a corrupt line is skipped, not fatal to the rest of the history
    }
  }
  return n === 0 ? [] : verdicts.slice(-n);
}

/**
 * The most recent {@link TickVerdict} per `phaseName`, read synchronously
 * from the same history log {@link readTickVerdicts} serves. `Phase.shouldRun`
 * and `Phase.handoff` (`spec/loop.md` "Declining a tick before the
 * invocation") are synchronous by contract, so a chain reading `headSha`/`at`
 * from either needs this rather than the async accessor behind an `await`
 * it cannot take. Corrupt lines are skipped, same no-false-signal posture as
 * `readTickVerdicts`; an absent log reads as an empty result, never a throw.
 * Absent is proven the same way its async sibling proves it — `existsLoud`
 * (`src/fsProbe.ts`) and an uncaught read — so a log that is present and
 * unreadable refuses here too, rather than handing a `shouldRun` an empty
 * anchor set that reads as "no phase has ever ticked"
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function readLatestVerdictsSync(
  flumeDir: string,
): Record<string, TickVerdict> {
  const p = namespacedJoin(tickVerdictsLogPath(flumeDir));
  const latest: Record<string, TickVerdict> = {};
  if (!existsLoud(p)) return latest;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec: unknown = JSON.parse(trimmed);
      // Log order is chronological (append-only), so the last record parsed
      // for a given phaseName is the most recent — no timestamp comparison
      // needed.
      if (isTickVerdict(rec)) latest[rec.phaseName] = rec;
    } catch {
      // a corrupt line is skipped, not fatal to the rest of the history
    }
  }
  return latest;
}
