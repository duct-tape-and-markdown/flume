/**
 * The package's default `handoff` (`spec/harness.md`, *The default
 * `handoff`*) — the ladder that reads one tick's reported facts and names
 * what runs next: the first live plan slice, else build while the engine
 * reports anything pickable, else hibernation.
 *
 * **Every input is a fact the engine reported.** The pickable set is
 * `TickResult.pickableAfter` — the dispatcher's own verdict, taken at the
 * same post-tick re-read the dispatcher took it at, never `isPickableNow`
 * re-run here with a default resolver and an empty capability set. Which
 * phase this handoff is running for is `TickResult.phaseName`, not a copy
 * closed over at construction. A build refusal is the tick's `noCommit` mode
 * and each entry's `mergeOutcome`, never a re-parse of the agent's final
 * message (`.claude/rules/engine-boundary.md`, *Told, not inferred*). What
 * the engine reports, this module reads; what it does not, this module does
 * not invent.
 *
 * **The taxonomies are keyed by the engine's own types.** A mode added to
 * `NoCommitMode`, or a fate added to `MergeOutcome`, is a type error in the
 * tables below rather than a fate the ladder silently routes as "not a
 * refusal" — the failure the untyped `ReadonlySet<string>` this replaces
 * could not catch.
 *
 * **The slices are a parameter.** Which windows a consumer's slices open
 * over, and how each is computed from disk, belong to the slices; this
 * module knows only their order and whether each says it is live. The chain
 * factory supplies them.
 *
 * **One write, beside the routing rather than inside it.** A wave that
 * shipped an entry marked {@link CONTRACT_TOUCHING_FIELD} leaves the stop
 * flag on disk ({@link stopAfterContractTouchingShip}) — the mechanization
 * `spec/loop.md`, *One tick is one fresh process*, points a chain at. It
 * never changes which phases the ladder names: the run ends at the next tick
 * boundary, and whatever this handoff woke is what the relaunched
 * supervisor picks up.
 */

import { writeFileSync } from "node:fs";

import type { MergeOutcome } from "../src/tickVerdict.js";
import { namespacedJoin, stopFlagPath } from "../src/paths.js";
import type { QueueParseFailure } from "../src/PendingSchema.js";
import type { Phase, TickResult } from "../src/Phase.js";
import type { NoCommitMode } from "../src/Prompt.js";

import {
  BUILD_PHASE,
  INBOX_PHASE,
  type HarnessPhase,
  type PlanSlice,
} from "./declaration.js";
import { CONTRACT_TOUCHING_FIELD } from "./entryExtension.js";

/**
 * A phase's `handoff` as the engine declares it, aliased so the declaration
 * schema and this module name one type rather than two spellings of
 * `(result: TickResult) => string[]`.
 */
export type Handoff = Phase["handoff"];

/**
 * What a slice's liveness predicate is handed: the tick's own reported state
 * root, whether the engine reports anything pickable, and whether the queue
 * this tick read resolved at all.
 *
 * All three are read off the `TickResult`, so a predicate never reaches for a
 * cwd, re-derives pickability, or re-parses the queue. A slice wanting more
 * than this is a fact the ladder should be handed, not one the predicate
 * should go find (`.claude/rules/engineering.md`, *A fact the engine holds is
 * reported, never rediscovered*).
 */
export interface SliceWindow {
  /** The tick's resolved state root — `TickResult.flumeDir`. */
  readonly flumeDir: string;
  /** Whether `TickResult.pickableAfter` named anything. */
  readonly pickable: boolean;
  /**
   * The queue's own parse failure — `TickResult.queueParseFailure`, absent on
   * every tick whose queue resolved.
   *
   * Present, nothing is pickable *because nothing resolved*, so `pickable`
   * above is `false` for a reason no slice can tell from a drained queue
   * without this field. Every slice the package ships declares the queue
   * writable, so every one of them is a phase the engine will run over an
   * unparseable queue (`spec/pending.md`, *Queue reads are strict*) — which
   * makes "did it resolve" the first question each liveness leg asks, not a
   * detail one of them happens to notice.
   *
   * Optional rather than required, like `TickFacts`' own fields
   * (`sliceWindow.ts`): a hand-built window that omits it reads as a queue
   * that resolved, which is the answer that leaves the ladder where it was.
   */
  readonly queueParseFailure?: QueueParseFailure | undefined;
}

/**
 * One plan slice the ladder may name, with the window that makes it live.
 *
 * `live` is pure over its inputs and synchronous: it runs on the selection
 * path, and the handoff the engine calls returns phase names, not a promise.
 */
export interface HandoffSlice {
  /** The phase name the ladder returns when this slice's window is open. */
  readonly name: PlanSlice;
  /** Whether this slice's window is open, given the tick's reported facts. */
  readonly live: (window: SliceWindow) => boolean;
}

/**
 * Which no-commit modes are refusals only a plan slice can resolve.
 *
 * `clean-exit` is a build agent that looked and declined; `render-refused`
 * is a prompt that never resolved, so no agent ran at all. Both leave the
 * entry exactly as pickable as it was, so the ladder naming build again
 * re-picks the same entry into the same wall — for a walled render, forever,
 * since nothing about the tree changes between attempts. Routing them to the
 * slice that drains records is what puts the refusal in front of the only
 * phase that can drop, re-scope, or answer the entry.
 *
 * `gate-revert` and `platform-preempt` are not plan's: a reverted commit and
 * a killed process are both worth retrying from the same queue, and a build
 * wave is what retries them.
 *
 * Exhaustive over {@link NoCommitMode} by type, so a mode the engine adds is
 * a type error here and must be classified rather than defaulting to "not a
 * refusal".
 *
 * Exported because the same question is asked of a second evidence: this
 * table reads a fate the engine reported on *this* tick's result, while the
 * inbox slice's window reads a prior-attempt record still standing on disk
 * from an earlier one (`inboxWindow.ts`). One classification, two evidences — a
 * copy beside the other reader is how a mode comes to route to the inbox
 * from a `TickResult` and nowhere from a record
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export const PLAN_RESOLVES_NO_COMMIT: Record<NoCommitMode, boolean> = {
  "clean-exit": true,
  "render-refused": true,
  "gate-revert": false,
  "platform-preempt": false,
};

/**
 * Which merge fates are refusals only a plan slice can resolve.
 *
 * `not-shipped` alone: a commit that landed and passed every gate which the
 * consumer's own `shipped` predicate declined — a park, whose reason is in
 * the note the tick wrote. Every other fate is the wave's to retry from the
 * next base; a cherry-pick conflict in particular is nobody's refusal.
 * `tip-moved` is a span discarded because its base stopped being an ancestor:
 * the agent's work was not at fault and the next wave starts from a live
 * base, so it too is the wave's.
 *
 * Exhaustive over {@link MergeOutcome} for the same reason the table above
 * is exhaustive over its union.
 *
 * Exported for the same reason, and for the same second evidence: the two
 * fates a `PriorAttempt` can carry — `not-shipped` and `tip-moved` — are the
 * ones the inbox slice's window reads off a record still standing on disk
 * from an earlier run (`inboxWindow.ts`). It composes its classification from
 * this table rather than restating either verdict, so the fate a build tick
 * routes on and the fate a record routes on cannot come apart
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export const PLAN_RESOLVES_MERGE: Record<MergeOutcome, boolean> = {
  "not-shipped": true,
  merged: false,
  "cherry-pick-conflict": false,
  "afterMerge-reverted": false,
  "afterMerge-revert-refused": false,
  "afterCommit-reverted": false,
  "tip-moved": false,
  "dropped-work": false,
};

/**
 * Whether this build tick carries a refusal only a plan slice can resolve —
 * the wave's own no-commit mode, or any one entry's mode or merge fate.
 *
 * Read per entry as well as per wave: a wave where one entry shipped reports
 * no wave-level `noCommit` at all, and a sibling's refusal would otherwise
 * be invisible here (`TickResult.entries`).
 */
function refusedForPlan(result: TickResult): boolean {
  if (result.noCommit !== undefined && PLAN_RESOLVES_NO_COMMIT[result.noCommit]) {
    return true;
  }
  return (result.entries ?? []).some(
    (entry) =>
      (entry.noCommit !== undefined && PLAN_RESOLVES_NO_COMMIT[entry.noCommit]) ||
      (entry.mergeOutcome !== undefined &&
        PLAN_RESOLVES_MERGE[entry.mergeOutcome]),
  );
}

/**
 * End the run when this tick shipped an entry the plan marked
 * contract-touching (`spec/loop.md`, *One tick is one fresh process*).
 *
 * A `flume loop` supervisor stays resident at its launch version while its
 * tick children re-read HEAD on every spawn, so a commit changing a
 * contract the two share is unsafe to absorb mid-run. The stop flag is the
 * documented operational answer, and this is that answer on existing
 * surface: the same file `flume stop` writes, read by the supervisor at the
 * same between-children boundary it re-reads the baton, so the in-flight
 * tick and the merge it is in the middle of complete untouched. The next
 * `loop` refuses over the flag until an operator removes it, which is the
 * relaunch the rule asks for.
 *
 * Keyed on the shipped entry's own reported `extension`, which is the only
 * place the mark survives: a shipped entry has left the queue, so nothing
 * else on the result still carries what it declared (`TickResult.entries`).
 * Singleton slices report no entries and so never write here — the mark, not
 * a branch on the phase name, is what scopes this to a fanout wave.
 *
 * The write is unguarded on purpose. A stop that failed silently is the
 * livelock this exists to prevent, wearing a green tick
 * (`.claude/rules/engineering.md`, *Loud or nothing*); the state root the
 * tick just ran out of is the directory being written to, so a throw here
 * means something an operator needs to see.
 */
function stopAfterContractTouchingShip(result: TickResult): void {
  const marked = (result.entries ?? []).some(
    (entry) => entry.shipped && entry.extension[CONTRACT_TOUCHING_FIELD] === true,
  );
  if (!marked) return;
  writeFileSync(namespacedJoin(stopFlagPath(result.flumeDir)), "");
}

/**
 * The ladder itself: the first live slice, else build while anything is
 * pickable, else hibernation.
 *
 * `exclude` is the slice that just ran and committed nothing. It made no
 * progress, so its window is open for exactly the reason it was open last
 * tick, and naming itself would spend every remaining tick of the loop on
 * the same wall — an unroutable record, a refused render. Excluded, it costs
 * one tick. A slice that *did* commit and is still live re-wakes itself:
 * that window is larger than one tick's budget, which is progress.
 */
function ladder(
  slices: readonly HandoffSlice[],
  window: SliceWindow,
  exclude?: string,
): string[] {
  const slice = slices.find(
    (candidate) => candidate.name !== exclude && candidate.live(window),
  );
  if (slice) return [slice.name];
  return window.pickable ? [BUILD_PHASE] : [];
}

/**
 * The package's default handoff, over the plan slices a consumer enabled.
 *
 * One value serves every phase the package constructs: which phase a result
 * came from is on the result, so a build tick takes the refusal leg and a
 * plan slice takes the no-self-rewake leg without either needing its own
 * closure over a name the engine already reports.
 *
 * Refuses a slice set with no {@link INBOX_PHASE} in it. The refusal leg has
 * nowhere to route without it, and the alternatives are both silent: naming
 * a phase the chain does not carry, or falling through to a ladder that
 * re-picks the refused entry for the rest of the run
 * (`.claude/rules/engineering.md`, *Loud or nothing*). A consumer running
 * without the inbox slice declares its own handoff instead, which is the
 * override this default exists to be replaced by.
 */
export function defaultHandoff(slices: readonly HandoffSlice[]): Handoff {
  if (!slices.some((slice) => slice.name === INBOX_PHASE)) {
    throw new Error(
      `the default handoff routes a build refusal to \`${INBOX_PHASE}\`, ` +
        `which is not among the slices it was given ` +
        `(${slices.map((slice) => slice.name).join(", ") || "none"}) — ` +
        `enable that slice or declare a handoff for the phases that need one`,
    );
  }

  return (result: TickResult): string[] => {
    stopAfterContractTouchingShip(result);

    // The parse failure is the decide-read's fact, so a tick that *repaired*
    // the queue still reports it and the ladder names the inbox once more.
    // That costs one declined tick — the next tick's `shouldRun` reads a
    // queue that now resolves, says no before anything is provisioned, and
    // its own handoff routes on from there. The alternative is a ladder
    // guessing from `pickableAfter` whether a repair landed, which is the
    // inference this module does not make (`.claude/rules/engine-boundary.md`,
    // *Told, not inferred*).
    const window: SliceWindow = {
      flumeDir: result.flumeDir,
      pickable: result.pickableAfter.length > 0,
      ...(result.queueParseFailure
        ? { queueParseFailure: result.queueParseFailure }
        : {}),
    };

    if (result.phaseName === BUILD_PHASE) {
      // Regardless of what is pickable: the refusal is build's note to plan,
      // and a queue with other work in it is exactly the case where the
      // ladder would otherwise hand the baton straight back to build.
      return refusedForPlan(result) ? [INBOX_PHASE] : ladder(slices, window);
    }

    return ladder(slices, window, result.committed ? undefined : result.phaseName);
  };
}

/** What {@link resolveHandoff} needs to decide one phase's handoff. */
export interface ResolveHandoffOptions {
  /** The phase whose handoff is being built. */
  readonly phase: HarnessPhase;
  /**
   * The consumer's declared handoffs, per phase; absent means the default.
   *
   * Each phase's value is optional **and** nullable, which is the shape the
   * declaration's own per-phase schema infers: a key present holding nothing
   * is the same "no override" a missing key is, and a narrower type here
   * would make the declaration unassignable to the surface that reads it.
   */
  readonly declared?:
    | Partial<Record<HarnessPhase, Handoff | undefined>>
    | undefined;
  /** The plan slices the ladder may name, in order. */
  readonly slices: readonly HandoffSlice[];
}

/**
 * The handoff one phase runs with: the consumer's declared one when it
 * declared one for that phase, else the package's default.
 *
 * **Replaces, never composes.** A declared handoff is the whole decision for
 * that phase — the package does not run its ladder first and let a
 * declaration amend it, because a handoff that only sometimes decides is a
 * consumer reasoning about two ladders instead of one. Per phase rather than
 * wholesale, so overriding build's routing does not force a consumer to copy
 * the slice ladder it did not want to change — copying is exactly what the
 * override exists to avoid (`spec/harness.md`, *The default `handoff`*).
 *
 * The default is constructed only where no declaration displaces it, so a
 * consumer that declared a handoff for every phase never meets its refusal.
 */
export function resolveHandoff(options: ResolveHandoffOptions): Handoff {
  return options.declared?.[options.phase] ?? defaultHandoff(options.slices);
}
