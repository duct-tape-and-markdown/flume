/**
 * The tick verdict — the facts artifact every tick that runs a phase leaves
 * behind: its shape, the stage-failure and merge-fate vocabularies it
 * carries, and the read/write/clear I/O over the three files it lives in —
 * the per-phase latest verdict, the bounded history log, and the per-phase
 * usage rows a running tick appends and the verdict's `invocations[]` is
 * composed from.
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

import {
  appendFile,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { readFileSync } from "node:fs";

import type { AgentUsage } from "./Agent.js";
import { bound } from "./bounds.js";
import { existsLoudUnder, isDirectoryOrAbsentUnder } from "./fsProbe.js";
import type { GateResult } from "./Gate.js";
import {
  invocationsDir,
  invocationsPath,
  invocationsPhaseOf,
  namespacedJoin,
  tickVerdictDir,
  tickVerdictPath,
  tickVerdictsLogPath,
} from "./paths.js";
import type { PidClaim } from "./pidClaim.js";
import { trimRenderedPrompts } from "./renderedPrompts.js";
import type { NoCommitMode } from "./Prompt.js";

/**
 * One pre-tick worktree provisioning failure — the
 * dispatcher never reached the agent for the affected entry (or, for a
 * repo-level failure, for any entry this tick).
 *
 * The exported name is pinned by `src/index.ts`'s barrel export and by
 * `tests/Dispatcher.test.ts`'s barrel-export pin, so it stays `ProvisionFailure`
 * — provision-stage only — even though {@link RenderFailure},
 * {@link MergeFailure} and {@link GateFailure} below now share its exact
 * shape for the three stages spec/loop.md's "Repeated identical failures"
 * generalized the backstop to.
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
 * A render-stage failure (`spec/chain.md`, *What a hook receives*): the prompt
 * never resolved, so no agent was invoked — an inline-exec span that would not
 * run (`InlineExecRenderError`, `src/Prompt.ts`), or a pre-invocation hook
 * (`shouldRun`, `promptArgs`) that threw, which the tick classes as the same
 * `render-refused`. `tag` is the fanout entry whose render refused; absent for
 * a singleton phase's own refusal (no entry to blame — same rationale as
 * {@link StageFailureEntry}, it falls to the consecutive-failure backstop
 * alone).
 *
 * The one stage with no other per-entry trace. A revert leaves a failing
 * `gateResults` row and a conflict leaves a `mergeOutcomes` record, but a
 * refusal reaches neither loop: it folds into the tick-level `noCommit`, and a
 * wave that shipped a sibling loses even that. Without this record an entry
 * whose render refuses identically every wave is re-picked at full price, and
 * nothing on the verdict says which entry refused or whether the refusal was
 * the same one.
 */
export type RenderFailure = StageFailureEntry & {
  /**
   * Same comparison-key contract as `ProvisionFailure.signature`: the failing
   * spans' commands, or the hook that threw and the message it raised. Keyed
   * on the wall rather than on everything the refusal printed — a span's
   * stderr and a throw's frames move with output that is not the wall, and
   * both ride `message` (or, for the frames, the prior-attempt record the
   * retry reads).
   */
  signature: string;
  message: string;
};

/**
 * A platform-stage failure (spec/loop.md "Repeated identical failures —
 * quarantine, then abort"): the agent process failed for non-work reasons —
 * a crash, an OOM kill, an expired login, a spent cap — so the attempt
 * classed a `platform-preempt` (`NoCommitMode`, `./Prompt.js`) rather than
 * an account of the work.
 *
 * Not a {@link StageFailureEntry}, and the one stage-failure record that is
 * not: the wall a preempt names belongs to the host, never to the entry the
 * slot happened to be carrying, so a platform failure is blamed on no entry
 * at all and feeds the consecutive-failure backstop alone. The type carries
 * that rather than a comment asking each producer to leave the blame half
 * off (`.claude/rules/engineering.md`, *Narration is the ladder's bottom
 * rung*), which also keeps a preempt out of the run quarantine's reach: an
 * expired login fails every tick identically, and holding the entry it
 * struck first would isolate a healthy entry for the rest of the run.
 *
 * Without this record the class reaches the prior-attempt slot alone
 * (`buildPlatformPreempt`, `./priorAttempts.js`) — read by the retry's own
 * prompt, never by a supervisor — and the verdict carries the tick-level
 * `platform-preempt` with no signature to compare one tick's preempt against
 * the next's.
 */
export interface PlatformFailure {
  /**
   * Same comparison-key contract as `ProvisionFailure.signature`: the
   * preempt class itself — the exit code, the abort, or the error raised
   * before exit — which is the whole wall a preempt has to name.
   */
  signature: string;
  message: string;
}

/**
 * A ship-stage failure (spec/loop.md "Repeated identical failures —
 * quarantine, then abort"): the chain's own `shipped` predicate *threw* over
 * one span that had already landed on trunk (`spec/chain.md`, *What a hook
 * receives*: a throw is not `false`), so the tick's ship decision for that
 * entry was never actually made. `signature` is the thrown message — the
 * chain's own hook failing for one entry, as a thrown `promptArgs` is at the
 * render stage ({@link RenderFailure}).
 *
 * A `shipped` that *returned* `false` records nothing here: a declined ship
 * is the chain's verdict on a commit that landed, not a failure of the tick
 * that produced it. {@link TickVerdictMergeOutcome.threw} is where the two
 * causes of one `not-shipped` are already held apart; this record is the
 * supervisor's half of that same split, so a predicate throwing identically
 * every wave joins a streak instead of being re-paid at full agent price.
 *
 * A {@link StageFailureEntry} whose blame half is always filled: `shipped` is
 * consulted only for a fanout entry whose span reached trunk, so there is
 * exactly one entry to blame. The pairing still rides the shared type rather
 * than a narrower shape of its own, so every stage failure the supervisor
 * folds is read through one vocabulary.
 */
export type ShipFailure = StageFailureEntry & {
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

/** Bound on a persisted stage-failure signature (provision/render/merge/gate/ship/platform alike) — a comparison key, not a transcript. */
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
 * The two facts a stage failure reports: the message the wall raised, and the
 * comparison key derived from it ({@link ProvisionFailure.signature}). Every
 * stage that records one — provision, merge, gate, ship, platform — carries
 * this pairing, so the derivation has one home rather than one spelling per
 * leg, where a rewording of either half would diverge silently
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * The key is the trimmed message bounded to {@link MAX_FAILURE_SIGNATURE}: the
 * same deterministic wall yields the same key tick over tick, and a
 * transcript-long message is truncated for comparison while `message` keeps
 * the words the log lines print.
 *
 * A stage whose key is *not* its own message builds the pairing from the key
 * it does have and says so at the site — a gate folds in the gate's name
 * ({@link gateFailureSignature}), a render refusal reads the wall its class
 * already names (`RenderRefusal.signature`, `src/Prompt.ts`).
 */
export function stageFailureFacts(message: string): {
  signature: string;
  message: string;
} {
  return { signature: bound(message.trim(), MAX_FAILURE_SIGNATURE), message };
}

/**
 * The {@link GateFailure} an afterMerge revert leaves behind when the reset
 * back to the pre-cherry-pick tip is itself refused (`ResetKeepRefusedError`,
 * `src/git.ts`): the gate condemned the commit, and now the commit cannot be
 * taken off trunk. The message names both shas, because the operator who
 * inherits the commit is the one who reads it.
 *
 * Both legs that can reach this state — a wave's per-entry merge
 * (`src/waveMerge.ts`) and a singleton phase's (`src/singletonTick.ts`) —
 * report the same two facts, so the words and the key they are compared by are
 * built once rather than spelled per leg, where a rewording would diverge
 * silently (`.claude/rules/engineering.md`, *A module is one job*). The
 * signature rides along: a key derived beside one leg's copy of the words is
 * the same duplicate one rung down.
 *
 * The blame half is the caller's: a wave attributes the refusal to the entry
 * whose gate failed unless that gate disowned the span, and a singleton has no
 * entry to blame at all ({@link GateFailure}).
 */
export function unrevertableMergeFailure(facts: {
  /** The refusal's own words — `ResetKeepRefusedError.message`. */
  refusal: string;
  /** The commit left on trunk: the tip the cherry-pick produced. */
  mergedSha: string;
  /** The tip the refused reset would have returned trunk to. */
  preCherry: string;
}): { signature: string; message: string } {
  const message = `${facts.refusal} — afterMerge-failed commit ${facts.mergedSha} stays on trunk, unrevertable to ${facts.preCherry}`;
  return stageFailureFacts(message);
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
 * One span of the tick's own non-agent time, on the clock the engine took it
 * with: a gate run, or one span's carry onto trunk. `invocations[]` states
 * what the agent cost; these rows state what the harness cost around it, so
 * gate and merge time is read off the verdict instead of differenced out of
 * two timestamps a reader went looking for (spec/loop.md "The tick verdict —
 * one facts artifact").
 *
 * The milliseconds are the engine's, never the chain's: a {@link GateResult}
 * carries no duration field and gains none. A gate reporting its own cost
 * would be a fact the engine copies rather than measures — and a gate that
 * threw would report nothing at all, while the run it spent that time in is
 * exactly the one worth timing.
 *
 * `kind` discriminates because the two rows name different subjects. A gate
 * row names the gate; a merge row names the entry whose span was carried,
 * absent for a singleton phase's own span, which has no entry to tag — the
 * same rule and the same name as {@link TickVerdictMergeOutcome.entryTag}.
 */
export type TickVerdictTiming =
  | { kind: "gate"; gate: string; ms: number }
  | { kind: "merge"; entryTag?: string; ms: number };

/**
 * Start the engine's own clock over a span about to run, returning the reader
 * that states its elapsed milliseconds.
 *
 * One home for the clock every {@link TickVerdictTiming} row is measured
 * against — the afterCommit loop's, both afterMerge loops', and each leg's
 * merge span — so "the engine's own clock" is one thing the artifact reports
 * rather than one `Date.now()` pair per measuring site
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export function startTiming(): () => number {
  const started = Date.now();
  return () => Date.now() - started;
}

/**
 * How a fanout entry's landed worktree commit fared once the wave tried to
 * put it on trunk:
 *  - `merged`                cherry-picked, passed every afterMerge gate, and
 *                            the agent's own termination never stated a park
 *                            — counted shipped. A span the tip already held
 *                            empties against it and is absorbed rather than
 *                            refused (spec/loop.md "Tip verify — one writer
 *                            per branch, absorption at the merge"), so a
 *                            `merged` row whose `baseSha` and `headSha` are
 *                            equal is a span merged with no commit to add.
 *  - `cherry-pick-conflict`  the cherry-pick itself failed; entry stays
 *                            pending, no commit reached trunk. A commit the
 *                            tip already holds is never this: it is skipped,
 *                            and the rest of the span lands.
 *  - `afterMerge-reverted`   landed, then an afterMerge gate failed; that
 *                            entry's commit alone was reset back off trunk.
 *  - `afterMerge-revert-refused` landed, an afterMerge gate failed, and the
 *                            `reset --keep` that would have carried the
 *                            commit back off trunk was itself refused — a
 *                            bystander's uncommitted work collides with the
 *                            paths the revert needs to touch (spec/loop.md
 *                            "Tip verify — one writer per branch, absorption
 *                            at the merge", "dropping it must not take
 *                            bystanders"). The commit stays on trunk, unlike
 *                            `afterMerge-reverted`; the entry stays pending
 *                            regardless, so it is never counted shipped. The
 *                            bounded exception to absorption the same section
 *                            names for a mid-history refusal — evidence left
 *                            for the operator rather than a forced wipe.
 *  - `afterCommit-reverted`  reverted inside the worktree by an afterCommit
 *                            gate; never reached cherry-pick, so it never
 *                            touched trunk on its own.
 *  - `not-shipped`           landed and passed every gate, but the phase's
 *                            own `shipped` predicate returned false
 *                            (spec/pending.md "Ship detection trusts the
 *                            agent's own account") — commit stays on trunk,
 *                            entry stays pending. The engine records the
 *                            chain's verdict and holds no vocabulary for its
 *                            reason.
 *  - `tip-moved`             the leg's own commit-onto-trunk step refused
 *                            because a live claim held the ref (a concurrent
 *                            engine instance, spec/loop.md "Tip verify — one
 *                            writer per branch, absorption at the merge") —
 *                            never reached cherry-pick, so under fanout the
 *                            entry stays pending and under singleton the
 *                            phase's span stays unmerged, either way for a
 *                            fresh retry once the claim clears. A
 *                            foreign non-engine commit on the ref, with no
 *                            live claim, is absorbed instead: git's own
 *                            conflict detection is the only content arbiter.
 *  - `dropped-work`          the per-entry tip-verify leg's own ancestry
 *                            check refused (spec/loop.md "Tip verify — one
 *                            writer per branch, absorption at the merge",
 *                            per-entry leg): this entry's worktree commit was
 *                            soft-reset because its recorded base was no
 *                            longer an ancestor of the observed HEAD — never
 *                            reached cherry-pick either, but distinct from
 *                            `tip-moved` above, which is the *shared trunk*
 *                            racing during this wave's own merge step. A
 *                            sibling fact so a dropped per-entry commit never
 *                            lands as silence a partial ship summary papers
 *                            over.
 *  - `wave-walled`           the span passed its afterCommit gates in its own
 *                            worktree and the wave was already walled when it
 *                            settled: a ledger rewrite behind an earlier pick
 *                            refused (`WaveLedgerRefusal`,
 *                            `src/waveMerge.ts`), so this attempt's facts
 *                            were folded and its span was never offered to
 *                            cherry-pick. Distinct from every kind above in
 *                            what did *not* happen — no pick was attempted,
 *                            so neither trunk nor this entry's own branch
 *                            refused anything — and the `baseSha`/`headSha`
 *                            pair is the whole of its point: the refusal
 *                            leaves the worktree branch standing, the next
 *                            start's teardown does not, and the span is
 *                            re-cherry-pickable from this row alone.
 */
export type MergeOutcome =
  | "merged"
  | "cherry-pick-conflict"
  | "afterMerge-reverted"
  | "afterMerge-revert-refused"
  | "afterCommit-reverted"
  | "not-shipped"
  | "tip-moved"
  | "dropped-work"
  | "wave-walled";

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
   * `afterCommit-reverted`, `cherry-pick-conflict`, `wave-walled`). Recovery
   * needs both: a span may hold several commits (spec/loop.md "The check is
   * ancestry, and N commits are completion"), and `headSha` alone re-picks
   * only the last of them. Absent only when the span never reached a commit
   * at all.
   */
  baseSha?: string;
  /**
   * The span's own head — the entry's cherry-picked commit sha once one
   * exists (`merged`, `afterMerge-reverted`, `not-shipped`), else the
   * worktree-branch commit sha the entry never got past (`tip-moved`,
   * `dropped-work`, `afterCommit-reverted`, `wave-walled`). Recovery, not
   * decoration: a span parked or refused after its gates passed must be
   * re-cherry-pickable from the verdict alone, never re-run at full agent
   * price — worktree teardown deletes the branch, but the commit object
   * survives in the shared store until gc, and this is the only place its sha
   * outlives the branch. Absent only when the entry never reached a commit at
   * all.
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
   * spec/loop.md "Tip verify — one writer per branch, absorption at the
   * merge": the tracked paths this run left dirty in its worktree — modified
   * and not committed — read while the worktree still existed, immediately
   * before teardown removes it and them. Covers the agent's own leftovers
   * and the content a soft-reset span (a tip-verify refusal, an
   * `afterCommit` gate revert) put back into the tree, whichever the tick
   * produced.
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
 * Some agent rows and the phase that ran them — the whole of what
 * {@link totalAgentUsageByPhase} reads. A {@link TickVerdict} is one of
 * these, which is how the supervisor keeps handing the fold its children's
 * verdicts unchanged; a reader holding rows that have not reached a verdict
 * yet — `flume status` over a tick still running (`src/runSpend.ts`) — has
 * the same two facts and needs no verdict built around them.
 */
export interface PhaseInvocations {
  readonly phaseName: string;
  readonly invocations: readonly TickVerdictInvocation[];
}

/**
 * Fold `spans` into one total per phase, in the order each phase first
 * invoked an agent. A phase appears only once a span of its own carried a
 * row, so "nothing was spent" and "nothing ran" read the same because they
 * are, and a set whose spans invoked nothing totals to an empty list rather
 * than a roster at zero.
 *
 * One grouping for every set of rows: `superviseLoop`
 * (`src/loopSupervisor.ts`) folds the run it just supervised, `flume status`
 * folds what the live run has written so far, and neither respells the
 * grouping beside the other (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*). Which rows are in the set is the caller's — the
 * supervisor holds its own children's verdicts, `status` bounds the rows on
 * disk by when the run claimed the lock.
 */
export function totalAgentUsageByPhase(
  spans: readonly PhaseInvocations[],
): PhaseAgentUsage[] {
  const byPhase = new Map<string, AgentUsageTotals>();
  for (const verdict of spans) {
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
   * spec/loop.md "The tick verdict — one facts artifact", "Every agent
   * invocation leaves a usage row": one entry per agent run this tick — one
   * for a singleton, one per provisioned entry that actually reached
   * `invokeAgent` under fanout. Empty when nothing this tick invoked the
   * agent at all (declined, render-refused, or nothing pickable).
   */
  invocations: TickVerdictInvocation[];
  /**
   * spec/loop.md "The tick verdict — one facts artifact": one
   * {@link TickVerdictTiming} row per gate run and per merge this tick took,
   * in the order the engine ran them. Beside the gate list the way
   * `invocations[]` is, and for the mirrored reason: that list says which
   * gates ran and what they ruled, this one says what they cost. Empty when
   * the tick ran no gate and merged no span.
   */
  timings: TickVerdictTiming[];
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
   * Render-stage failures this tick recorded — a prompt that never resolved,
   * so no agent ran for the entry it is blamed on
   * (`spec/chain.md`, *What a hook receives*). Absent/empty when every render
   * this tick reached resolved.
   */
  renderFailures?: RenderFailure[];
  /**
   * Merge-stage cherry-pick-conflict failures this tick recorded
   * (spec/loop.md "Repeated identical failures — quarantine, then
   * abort"). Absent/empty when the tick hit none.
   */
  mergeFailures?: MergeFailure[];
  /**
   * Gate-stage failures — an afterCommit
   * or afterMerge gate revert — this tick recorded. Absent/empty when the
   * tick hit none.
   */
  gateFailures?: GateFailure[];
  /**
   * Platform-stage failures this tick recorded — one per agent that failed
   * for non-work reasons, each blamed on no entry
   * ({@link PlatformFailure}). Absent/empty when every agent this tick
   * invoked reached an exit of its own.
   */
  platformFailures?: PlatformFailure[];
  /**
   * Ship-stage failures this tick recorded — one per merged span whose
   * `shipped` consult threw, each blamed on the entry the pick carried
   * ({@link ShipFailure}). Absent/empty when every consult this tick made
   * returned.
   */
  shipFailures?: ShipFailure[];
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
 * What a producer hands {@link buildTickVerdict} — the facts, in the shape
 * each producer already holds them. Optional here means the same thing the
 * verdict's own field docs mean by "absent/empty": a fact the tick did not
 * hit. A producer passes what it has, empty or undefined alike, and never
 * spells the emptiness test itself.
 *
 * Deliberately not exported: it is the builder's parameter, named by no
 * shipped signature, so it earns no place on the package surface
 * (`.claude/rules/engineering.md`, *An export earns its consumer*).
 */
interface TickVerdictFacts {
  phaseName: string;
  tags: readonly string[];
  committed: boolean;
  noCommit?: NoCommitMode | undefined;
  tipMoved?: boolean | undefined;
  declined?: boolean | undefined;
  bystanderCheckpointSha?: string | undefined;
  gateResults: readonly ReportedGateResult[];
  shippedTags: readonly string[];
  mergeOutcomes?: readonly TickVerdictMergeOutcome[] | undefined;
  invocations?: readonly TickVerdictInvocation[] | undefined;
  timings?: readonly TickVerdictTiming[] | undefined;
  provisionFailures?: readonly ProvisionFailure[] | undefined;
  stakeLosses?: readonly StakeLoss[] | undefined;
  renderFailures?: readonly RenderFailure[] | undefined;
  mergeFailures?: readonly MergeFailure[] | undefined;
  gateFailures?: readonly GateFailure[] | undefined;
  platformFailures?: readonly PlatformFailure[] | undefined;
  shipFailures?: readonly ShipFailure[] | undefined;
  clearedPriorAttempts?: readonly string[] | undefined;
  summary: string;
  /**
   * The trunk tip, read by the producer at the point its own stage says the
   * tip is final — after a tick's own commits landed, or after the picks a
   * refused ledger rewrite left standing. Not read here, because which read
   * point is the right one is the producer's fact, not the shaping's.
   */
  headSha: string;
}

/**
 * The one shaping of a {@link TickVerdict}: every field, in one order, under
 * one rule for which optional fact is omitted.
 *
 * Two producers call it — the dispatcher at the end of a tick, and the wave's
 * merge stage for the partial verdict a refused pending-ledger rewrite rides
 * out on. They differ in the facts they hold and the summary they name,
 * nothing else, so the sequence is one function with two callers rather than
 * two copies that agree by discipline (`.claude/rules/engineering.md`, *A
 * module is one job*). A field the shape gains cannot reach one producer's
 * verdict and miss the other's.
 *
 * `at` is read here because here is when the verdict was built; every array
 * is copied, so a producer's own bookkeeping cannot mutate a verdict it
 * already handed over.
 */
export function buildTickVerdict(facts: TickVerdictFacts): TickVerdict {
  return {
    phaseName: facts.phaseName,
    tags: [...facts.tags],
    committed: facts.committed,
    ...(facts.noCommit ? { noCommit: facts.noCommit } : {}),
    ...(facts.tipMoved ? { tipMoved: facts.tipMoved } : {}),
    ...(facts.declined ? { declined: facts.declined } : {}),
    ...(facts.bystanderCheckpointSha
      ? { bystanderCheckpointSha: facts.bystanderCheckpointSha }
      : {}),
    gateResults: [...facts.gateResults],
    shippedTags: [...facts.shippedTags],
    mergeOutcomes: [...(facts.mergeOutcomes ?? [])],
    invocations: [...(facts.invocations ?? [])],
    timings: [...(facts.timings ?? [])],
    ...(facts.provisionFailures?.length
      ? { provisionFailures: [...facts.provisionFailures] }
      : {}),
    ...(facts.stakeLosses?.length
      ? { stakeLosses: [...facts.stakeLosses] }
      : {}),
    ...(facts.renderFailures?.length
      ? { renderFailures: [...facts.renderFailures] }
      : {}),
    ...(facts.mergeFailures?.length
      ? { mergeFailures: [...facts.mergeFailures] }
      : {}),
    ...(facts.gateFailures?.length
      ? { gateFailures: [...facts.gateFailures] }
      : {}),
    ...(facts.platformFailures?.length
      ? { platformFailures: [...facts.platformFailures] }
      : {}),
    ...(facts.shipFailures?.length
      ? { shipFailures: [...facts.shipFailures] }
      : {}),
    ...(facts.clearedPriorAttempts?.length
      ? { clearedPriorAttempts: [...facts.clearedPriorAttempts] }
      : {}),
    summary: facts.summary,
    headSha: facts.headSha,
    at: new Date().toISOString(),
  };
}

/**
 * The facts {@link buildTickVerdict} spreads conditionally — every optional
 * key of {@link TickVerdict}, computed from the shape rather than listed
 * against it. Optional on the shape and omitted-when-empty by the builder
 * are the same set by construction: the builder's return is a
 * {@link TickVerdict}, so a required field it stopped writing fails the
 * typecheck and a conditional spread of a required field is one the
 * typecheck already refuses to leave out.
 *
 * Exported for the suite, whose two-producer comparison asserts the wave it
 * drives reaches each of these — a roster keyed off this type cannot fall
 * behind a fact the builder grows, and the comparison stops reading complete
 * over a set narrower than its claim (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*).
 */
export type ConditionalTickVerdictFact = {
  [K in keyof TickVerdict]-?: Record<string, never> extends Pick<TickVerdict, K>
    ? K
    : never;
}[keyof TickVerdict];

/**
 * The other half: every field {@link buildTickVerdict} writes on every
 * verdict, and so every field a decode may require of a row. Read by
 * {@link ALWAYS_WRITTEN} here, and by the suite's agreement case, which
 * drives a real verdict through the real history reader one missing field at
 * a time.
 */
export type RequiredTickVerdictField = Exclude<
  keyof TickVerdict,
  ConditionalTickVerdictFact
>;

/**
 * Three files under the state dir, every one a stable path and none a
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
 *  - {@link invocationsPath} — the usage rows of the tick of that phase
 *    running *now*, appended one per agent as it returns
 *    ({@link appendInvocationRow}) and read back where a verdict is built
 *    ({@link readInvocationRows}). Per phase for the same reason the verdict
 *    file is, and cleared by {@link clearInvocationRows} at the start of that
 *    phase's next tick — the one artifact here written mid-tick, because the
 *    spend it records is paid mid-tick.
 */
export {
  invocationsDir,
  invocationsPath,
  tickVerdictDir,
  tickVerdictPath,
  tickVerdictsLogPath,
};

/**
 * Bound on {@link tickVerdictsLogPath}'s file — a rolling window, not an
 * unbounded log. Over the file's *lines*, not over the records this engine
 * version can decode: {@link writeTickVerdict} carries every line forward
 * verbatim, so a row {@link isTickVerdict} declines occupies the window the
 * same way a decodable one does — and still names its prompts while it does.
 *
 * It bounds `<flumeDir>/rendered-prompts/` too, and by itself: a rendered
 * prompt lives exactly as long as a line still in this window names it as
 * `promptPath` (spec/prompt.md, *The rendered prompt is persisted before the
 * agent runs*), so the directory has no retention setting of its own to hold
 * a second, disagreeing answer.
 *
 * Exported for the suite, which drives the window past its own edge rather
 * than restating the number beside it
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
export const MAX_TICK_VERDICTS = 200;

/**
 * Engine default for how much of that window `flume log` prints when the
 * operator names no `-n` — a tail of the same history {@link
 * MAX_TICK_VERDICTS} bounds, so the two live together. One home: the verb
 * reads it and `src/cliHelp.ts` interpolates it into every page that states
 * it, rather than each spelling the number again
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
export const DEFAULT_LOG_VERDICTS = 10;

/** The check every `string`-typed field of the roster below is read with. */
const isString = (value: unknown): boolean => typeof value === "string";

/**
 * What the decode requires of each field {@link buildTickVerdict} always
 * writes — the {@link RequiredTickVerdictField} half, keyed off the shape
 * rather than listed beside it. A field joining {@link TickVerdict} as
 * required joins this roster or the typecheck refuses the mapped type,
 * so the guard below cannot fall behind the builder that feeds it
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * Each value is the check that field's own type earns at decode time: a
 * declared `string` is read as a string, a declared array as an array. The
 * element types are not walked — a row's arrays are this engine version's
 * to read, and a stricter probe would decline a history line whose element
 * shape predates it, which is the truncation {@link writeTickVerdict}'s
 * line-preserving append exists to avoid.
 */
const ALWAYS_WRITTEN: {
  [K in RequiredTickVerdictField]: (value: unknown) => boolean;
} = {
  phaseName: isString,
  tags: Array.isArray,
  committed: (value) => typeof value === "boolean",
  gateResults: Array.isArray,
  shippedTags: Array.isArray,
  mergeOutcomes: Array.isArray,
  invocations: Array.isArray,
  timings: Array.isArray,
  summary: isString,
  headSha: isString,
  at: isString,
};

/** Structural check a parsed JSON value is shaped like a {@link TickVerdict} — corrupt or partial input degrades to "not a verdict", never a thrown parse error surfacing as a tick failure. */
function isTickVerdict(rec: unknown): rec is TickVerdict {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as Record<string, unknown>;
  return Object.entries(ALWAYS_WRITTEN).every(([field, holds]) =>
    holds(r[field]),
  );
}

/**
 * The refusal one of the readers below raises when the artifact it
 * probed present turns out to be unreadable, naming the path it read.
 *
 * Each reader sits past a descent from the state root — `existsLoudUnder`
 * for a file leaf, `isDirectoryOrAbsentUnder` for a directory
 * (`src/fsProbe.ts`) — so absence is already proven on either host and what
 * remains is a read that failed on an open
 * descriptor — and such a failure carries the syscall, never the path the
 * caller passed (`.claude/rules/platform-facts.md`, *A read that fails after
 * the open names no path*). Rethrown bare it reaches a verb, a supervisor
 * line or an API consumer as `EISDIR: illegal operation on a directory,
 * read` with nothing to go fix, under a state root a chain may have
 * relocated. So the reader states the path and the errno's own sentence
 * rides along as detail; the original stays on `cause` for anyone keying on
 * it.
 *
 * `what` names the subject as a bare noun phrase, the way `isDirectoryOrAbsent`
 * (`src/fsProbe.ts`) and `readRecord` (`src/priorAttempts.ts`) already spell
 * it — one vocabulary for "present, and could not be read".
 */
function unreadable(what: string, path: string, cause: unknown): Error {
  return new Error(
    `[flume] ${what} is unreadable: ${path} — ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    { cause },
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
 *
 * The message is the cause's, relayed: both refusals {@link readTickVerdicts}
 * can raise — `existsLoudUnder`'s, which states the path its descent stopped
 * at (or relays the stat error node already spelled the path into), and
 * {@link unreadable}'s, which states the log it read — already name a path, so
 * a prepend here would print one twice in a single operator line.
 */
export class VerdictHistoryUnreadableError extends Error {
  /** The history log the read refused on, resolved. */
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), {
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
 * The append carries the log's existing lines forward **verbatim** rather
 * than re-serializing the records {@link isTickVerdict} accepted. That check
 * is this engine version's reading of the shape, and a row written before a
 * field joined {@link TickVerdict} is one it declines — re-serializing the
 * decoded set would delete every such row on the next tick, which is the one
 * thing a log the spec calls history, never cleared, must not do
 * (spec/loop.md, *The tick verdict — one facts artifact*). Declining a row is
 * a statement about what a reader can hand a chain, never a licence to drop
 * it from the file.
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
  let lines: string[];
  try {
    lines = await readVerdictLogLines(flumeDir);
  } catch (err) {
    throw new VerdictHistoryUnreadableError(tickVerdictsLogPath(flumeDir), err);
  }
  const bounded = [...lines, JSON.stringify(verdict)].slice(-MAX_TICK_VERDICTS);
  await writeFile(
    namespacedJoin(tickVerdictsLogPath(flumeDir)),
    bounded.join("\n") + "\n",
    "utf8",
  );
  // The slice above is the one place a verdict leaves the retained set, so it
  // is where the rendered prompts that verdict was the last to name stop
  // being anyone's. The trim reads the lines just written, never the decoded
  // set: a line this version declines still names its prompts, and trimming
  // by what `isTickVerdict` accepts would delete the input record of every
  // tick that ran under an older shape.
  const retained = retainedPromptPaths(bounded);
  if (retained !== undefined) await trimRenderedPrompts(flumeDir, retained);
}

/**
 * Every `promptPath` the history's lines name, or `undefined` when a line
 * would not parse at all.
 *
 * Read off the lines rather than the records, for the reason the append
 * carries lines rather than records: this engine version's structural check
 * is a statement about what a reader hands a chain, and a row it declines is
 * still a row whose input file something may want.
 *
 * `undefined` rather than a partial set, because the two errors are not
 * symmetric: an unparsable line names prompts no reader here can enumerate,
 * and treating it as naming none would delete files it may be the last
 * holder of. A trim that cannot resolve its retained set keeps everything —
 * the directory grows until a well-formed append trims it, which is the
 * failure that costs disk rather than evidence
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function retainedPromptPaths(
  lines: readonly string[],
): ReadonlySet<string> | undefined {
  const paths = new Set<string>();
  for (const line of lines) {
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      return undefined;
    }
    const rows = (rec as { invocations?: unknown } | null)?.invocations;
    if (!Array.isArray(rows)) continue;
    for (const row of rows as readonly unknown[]) {
      const promptPath = (row as { promptPath?: unknown } | null)?.promptPath;
      if (typeof promptPath === "string") paths.add(promptPath);
    }
  }
  return paths;
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
 * spec/loop.md "Every agent invocation leaves a usage row": append one row to
 * `phase`'s usage-row file, at the moment the agent it describes returned.
 *
 * Both legs call it — the wave's per-attempt fold (`src/waveMerge.ts`) and
 * the singleton's one attempt (`src/singletonTick.ts`) — so the row is on
 * disk before the pick, the gates and the teardown that follow it, and a tick
 * that dies anywhere past here keeps the spend it already paid for. Spend is
 * state on disk, not a total held in memory until the tick settles
 * (`spec/loop.md`, *Crash equals stop*).
 *
 * Append rather than rewrite: the file is one tick's, and a rewrite of the
 * whole set per agent would lose every earlier row to a crash mid-write —
 * the failure this artifact exists to close. {@link clearInvocationRows} is
 * what bounds it; nothing here trims.
 */
export async function appendInvocationRow(
  flumeDir: string,
  phase: string,
  row: TickVerdictInvocation,
): Promise<void> {
  // The rows dir nests inside the state root, so one recursive mkdir creates
  // both. win32 MAX_PATH: flumeDir nests under a job/worktree root;
  // namespacedJoin (src/paths.ts) is the shared idiom.
  await mkdir(namespacedJoin(invocationsDir(flumeDir)), { recursive: true });
  await appendFile(
    namespacedJoin(invocationsPath(flumeDir, phase)),
    JSON.stringify(row) + "\n",
    "utf8",
  );
}

/**
 * The usage rows `phase`'s running tick has left so far, oldest first — what
 * a verdict's `invocations[]` is composed from, by the dispatcher at the end
 * of a tick and by the partial verdict a torn-down wave rides out on
 * (`src/waveMerge.ts`). Neither producer holds a second copy of the set
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * Absent reads as no rows — a tick whose agents never ran wrote no file. It
 * is the only silent reading and it is **proven**: `existsLoudUnder`
 * (`src/fsProbe.ts`) descends from the state root before it stats the leaf,
 * so a plain file standing anywhere above the rows file refuses rather than
 * answering that leaf's own stat `ENOENT` on win32
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), and the read
 * past it refuses under {@link unreadable}, so a rows file that is present and
 * unreadable refuses rather than reporting a tick that paid for agents as one
 * that paid for none (`.claude/rules/engineering.md`, *Loud or nothing*). A
 * line that will not parse, or that is not a row this engine version reads, is
 * skipped the way a history line is: an append cut short by the crash the
 * artifact is written against must not cost the rows before it.
 */
export async function readInvocationRows(
  flumeDir: string,
  phase: string,
): Promise<TickVerdictInvocation[]> {
  const path = invocationsPath(flumeDir, phase);
  const p = namespacedJoin(path);
  if (!existsLoudUnder("tick usage rows", flumeDir, path)) return [];
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    throw unreadable("tick usage rows", path, err);
  }
  const rows: TickVerdictInvocation[] = [];
  for (const line of verdictLogLines(raw)) {
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (isInvocationRow(rec)) rows.push(rec);
  }
  return rows;
}

/** Structural check a parsed line is shaped like a {@link TickVerdictInvocation} — the two fields every row carries, whatever the agent reported. */
function isInvocationRow(rec: unknown): rec is TickVerdictInvocation {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as Partial<TickVerdictInvocation>;
  return typeof r.promptPath === "string" && Array.isArray(r.uncommittedTracked);
}

/**
 * Every phase's in-progress usage rows, one span per phase whose rows file
 * holds any, phase-name order. The cross-phase face of
 * {@link readInvocationRows} above, for a reader that wants what the state
 * root is paying for right now without knowing which phases a chain
 * declares — `flume status` under a live supervisor (`src/runSpend.ts`),
 * which must report a running tick's spend whether or not its chain loaded.
 *
 * The phase each file names comes back through `invocationsPhaseOf`
 * (`src/paths.ts`), the inverse of the naming {@link appendInvocationRow}
 * wrote it under, so the enumeration and the writer share one spelling of the
 * suffix. A name that is not a rows file is skipped.
 *
 * Absent reads as no rows, and is **proven** the same way every other read of
 * this artifact proves it: `isDirectoryOrAbsentUnder` (`src/fsProbe.ts`)
 * descends from the state root, so a plain file standing anywhere above the
 * rows dir refuses rather than answering the listing `ENOENT` on win32
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*) and reporting a paying run as one that has
 * spent nothing (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export async function readAllInvocationRows(
  flumeDir: string,
): Promise<PhaseInvocations[]> {
  const dir = invocationsDir(flumeDir);
  if (!isDirectoryOrAbsentUnder("tick usage rows", flumeDir, dir)) return [];
  let names: string[];
  try {
    names = await readdir(namespacedJoin(dir));
  } catch (err) {
    throw unreadable("tick usage rows", dir, err);
  }
  const spans: PhaseInvocations[] = [];
  for (const name of [...names].sort()) {
    const phaseName = invocationsPhaseOf(name);
    if (phaseName === undefined) continue;
    const invocations = await readInvocationRows(flumeDir, phaseName);
    if (invocations.length > 0) spans.push({ phaseName, invocations });
  }
  return spans;
}

/**
 * Clear `phase`'s usage rows before that phase's next tick reaches its own
 * work — called by `Dispatcher.tick()` once the phase is chosen and before
 * either leg runs, so the file a verdict composes from holds this tick's rows
 * and no earlier tick's.
 *
 * Scoped to one phase for the same reason {@link clearTickVerdict}'s named
 * arm is: a supervisor run holds one child per awake phase, and a clear of the
 * whole directory would take a live sibling's rows with it — including the
 * rows of agents that had already been paid for.
 */
export async function clearInvocationRows(
  flumeDir: string,
  phase: string,
): Promise<void> {
  await rm(namespacedJoin(invocationsPath(flumeDir, phase)), { force: true });
}

/**
 * Read `phase`'s last-written verdict, if any — consulted by `superviseLoop`
 * (`src/loopSupervisor.ts`), this export's only consumer, between child
 * ticks, with the phase it named the child by. Corrupt or absent (the CLI clears it before every
 * tick and writes it only once that tick's `dispatcher.tick()` call has
 * returned) degrades to "nothing to report" — a missing record must never
 * be misread as a prior tick's stale one.
 *
 * Absent is the only silent reading, and it is **proven**: `existsLoudUnder`
 * (`src/fsProbe.ts`) descends from the state root before it stats the record,
 * so an obstructed ancestor refuses rather than answering the record's own
 * stat `ENOENT` on win32 (`.claude/rules/platform-facts.md`, *win32 reports a
 * path through a non-directory as not found*), and the read
 * past it refuses under {@link unreadable}, so a verdict file that is present
 * and unreadable — a directory in its place, a permission-denied parent, a
 * symlink loop — refuses here instead of reporting the tick that wrote it
 * as one that left nothing behind (`.claude/rules/engineering.md`, *Loud or
 * nothing*), and `superviseLoop`'s line quotes a refusal that names the
 * record. The degrade that remains is the parse alone, which is a
 * statement about the file's *contents*, not about whether it was read.
 */
export async function readTickVerdict(
  flumeDir: string,
  phase: string,
): Promise<TickVerdict | undefined> {
  const path = tickVerdictPath(flumeDir, phase);
  const p = namespacedJoin(path);
  if (!existsLoudUnder("tick verdict record", flumeDir, path)) return undefined;
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    throw unreadable("tick verdict record", path, err);
  }
  try {
    const rec: unknown = JSON.parse(raw);
    return isTickVerdict(rec) ? rec : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The history log's lines as its last writer left them — one record per
 * line, blanks dropped, nothing decoded. Absent reads as no lines, proven by
 * `existsLoudUnder`'s descent from the state root (`src/fsProbe.ts`) rather
 * than by one stat of the leaf; present
 * and unreadable refuses under {@link unreadable}, the posture the readers
 * below and {@link writeTickVerdict} share
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * The append and the read part ways here because they want different things
 * from the same bytes: a read wants the records this engine version
 * understands, the append wants every line the file holds.
 */
async function readVerdictLogLines(flumeDir: string): Promise<string[]> {
  const path = tickVerdictsLogPath(flumeDir);
  const p = namespacedJoin(path);
  if (!existsLoudUnder("tick verdict history log", flumeDir, path)) return [];
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    throw unreadable("tick verdict history log", path, err);
  }
  return verdictLogLines(raw);
}

/** A history log's contents split into its non-empty lines, trimmed — one spelling for {@link readVerdictLogLines} and the sync reader that cannot await it. */
function verdictLogLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * One history line as a verdict, or `undefined` when it will not parse or is
 * not a record {@link isTickVerdict} accepts — a line a reader skips rather
 * than throws on, and one {@link writeTickVerdict} carries forward
 * regardless.
 */
function decodeVerdictLine(line: string): TickVerdict | undefined {
  try {
    const rec: unknown = JSON.parse(line);
    return isTickVerdict(rec) ? rec : undefined;
  } catch {
    // a corrupt line is skipped, not fatal to the rest of the history
    return undefined;
  }
}

/**
 * Read up to the last `n` verdicts (oldest first), for a chain to render
 * recent tick history into a prompt. Corrupt lines are skipped,
 * never thrown; an absent log reads as empty history — same no-false-signal
 * posture as every other artifact the harness persists.
 *
 * Absent, and nothing else: `existsLoudUnder`'s descent from the state root
 * (`src/fsProbe.ts`) proves it — an obstructed ancestor refuses rather than
 * reading as a repo that has never ticked, which is what one stat of the leaf
 * answers on win32 (`.claude/rules/platform-facts.md`, *win32 reports a path
 * through a non-directory as not found*) — and
 * the read past it refuses under {@link unreadable}, so a history log that is
 * present and unreadable refuses rather than answering "no history" — the one answer
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
  const verdicts: TickVerdict[] = [];
  for (const line of await readVerdictLogLines(flumeDir)) {
    const rec = decodeVerdictLine(line);
    if (rec) verdicts.push(rec);
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
 * Absent is proven the same way its async sibling proves it — the descent
 * `existsLoudUnder` (`src/fsProbe.ts`) runs from the state root, and a read
 * refusing under {@link unreadable} — so a log
 * that is present and
 * unreadable refuses here too, rather than handing a `shouldRun` an empty
 * anchor set that reads as "no phase has ever ticked"
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function readLatestVerdictsSync(
  flumeDir: string,
): Record<string, TickVerdict> {
  const path = tickVerdictsLogPath(flumeDir);
  const p = namespacedJoin(path);
  const latest: Record<string, TickVerdict> = {};
  if (!existsLoudUnder("tick verdict history log", flumeDir, path))
    return latest;
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (err) {
    throw unreadable("tick verdict history log", path, err);
  }
  for (const line of verdictLogLines(raw)) {
    // Log order is chronological (append-only), so the last record parsed
    // for a given phaseName is the most recent — no timestamp comparison
    // needed.
    const rec = decodeVerdictLine(line);
    if (rec) latest[rec.phaseName] = rec;
  }
  return latest;
}
