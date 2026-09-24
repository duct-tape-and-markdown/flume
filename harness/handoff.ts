/**
 * The package's default `handoff` (`spec/harness.md`, *The default
 * `handoff`*) — the wake set it reads off one tick's reported facts: every
 * slice whose window is live, plus build whenever the engine reports
 * anything pickable, named together in one answer. Hibernation is that set
 * coming out empty, never a rung a walk fell off the bottom of.
 *
 * **One answer, not a first choice.** How many of the woken phases run at
 * once is the supervisor's budget, and which of them runs first is the
 * chain's declared phase order — build first, the plan slices behind it. A
 * handoff naming one phase would be deciding both on their behalf, and a
 * consumer that raised its budget would still get one tick at a time.
 *
 * **Every input is a fact the engine reported.** The pickable set is
 * `TickResult.pickableAfter` — the dispatcher's own verdict, taken at the
 * same post-tick re-read the dispatcher took it at, never `isPickableNow`
 * re-run here with a default resolver and an empty capability set. Which
 * phase this handoff is running for is `TickResult.phaseName`, not a copy
 * closed over at construction. A standing build refusal is the record store
 * as the tick left it — `TickResult.priorAttempts` against
 * `TickResult.pendingAfter` — never a re-parse of the agent's final message
 * and never the engine's own fates re-classified into the records they were
 * stamped onto (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 * What the engine reports, this module reads; what it does not, this module
 * does not invent.
 *
 * **The taxonomy is keyed by the engine's own types**, and it lives beside
 * the other reader of it rather than here (`standingRefusal.ts`): the inbox
 * slice's window asks the same question of the same records at its
 * `shouldRun` consult, and one table with two callers is what keeps the two
 * from drifting.
 *
 * **The slices are a parameter.** Which windows a consumer's slices open
 * over, and how each is computed from disk, belong to the slices; this
 * module knows only their order and whether each says it is live. The chain
 * factory supplies them.
 *
 * **Two answers, one question.** The wake set names which phases the next
 * tick may run; {@link defaultRefusesEntry} names which entries build may be
 * handed when it does. Both are "what does the next tick get", both read only
 * facts the engine reported, and splitting them across two modules would put
 * the wave-level refusal and the per-entry one where neither can see that
 * they classify the same records.
 *
 * **One write, beside the routing rather than inside it.** A wave that
 * shipped an entry marked {@link CONTRACT_TOUCHING_FIELD} leaves the stop
 * flag on disk ({@link stopAfterContractTouchingShip}) — the mechanization
 * `spec/loop.md`, *One tick is one fresh process*, points a chain at. It
 * never changes which phases the set names: the run ends at the next tick
 * boundary, and whatever this handoff woke is what the relaunched
 * supervisor picks up. It is the package's floor rather than its default, so
 * a consumer's own handoff runs beneath it too ({@link resolveHandoff}).
 */

import { writeFileSync } from "node:fs";

import { namespacedJoin, stopFlagPath } from "../src/paths.js";
import type { QueueParseFailure } from "../src/PendingSchema.js";
import type { EntryRefusalContext, Phase, TickResult } from "../src/Phase.js";
import type { PriorAttempt } from "../src/Prompt.js";

import {
  BUILD_PHASE,
  INBOX_PHASE,
  type HarnessPhase,
  type PlanSlice,
} from "./declaration.js";
import { CONTRACT_TOUCHING_FIELD } from "./entryExtension.js";
import { standingRefusals } from "./standingRefusal.js";

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
 * than this is a fact the handoff should be handed, not one the predicate
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
   * that resolved, which is the answer that leaves the wake set where it was.
   */
  readonly queueParseFailure?: QueueParseFailure | undefined;
}

/**
 * One plan slice the wake set may name, with the window that makes it live.
 *
 * `live` is pure over its inputs and synchronous: it runs on the selection
 * path, and the handoff the engine calls returns phase names, not a promise.
 */
export interface HandoffSlice {
  /** The phase name the set carries when this slice's window is open. */
  readonly name: PlanSlice;
  /** Whether this slice's window is open, given the tick's reported facts. */
  readonly live: (window: SliceWindow) => boolean;
}

/**
 * Which prior-attempt modes describe an outcome only a producer can move.
 *
 * `clean-exit` alone. The agent ran, read the entry, and committed nothing —
 * so what it decided is a function of the entry it was handed, and
 * re-dispatching it against that same declaration buys the same decision at
 * full agent price. Every other mode names something the next wave can change
 * with nobody rewriting anything: a `gate-revert` leaves the gate's own
 * verdict on the record for the retry to read, a `platform-preempt` never
 * reached the work at all, a `render-refused` failed on spans and hooks that
 * resolve against the environment, a `not-shipped` park and a `tip-moved` span
 * are both the wave's to carry from its next base.
 *
 * Exhaustive over `PriorAttempt["mode"]` by type, for the reason the two
 * tables above are exhaustive over theirs: a mode the engine adds is a type
 * error here and must be classified, rather than defaulting to "hand it to
 * build again" — the direction that costs an invocation per tick for the rest
 * of the run.
 */
const RESOLVED_BY_A_PRODUCER: Record<PriorAttempt["mode"], boolean> = {
  "clean-exit": true,
  "gate-revert": false,
  "platform-preempt": false,
  "render-refused": false,
  "not-shipped": false,
  "tip-moved": false,
};

/**
 * The package's per-entry refusal (`spec/harness.md`, *The default
 * `handoff`*) — the chain's own `refusesEntry` (`src/Phase.ts`), which the
 * engine consults over every entry the gate switch and this run's quarantine
 * both cleared, and which the harness is the first declarer of.
 *
 * Refuses exactly one case: the entry's latest prior attempt was a clean exit
 * ({@link RESOLVED_BY_A_PRODUCER}) written against the entry **as the queue now
 * declares it**. Both halves are the engine's own facts, and neither is
 * composed here — the `mode` it stamped on the record, and the declaration key
 * it reports twice, once on the record it wrote and once for the entry this
 * selection is about (`EntryRefusalContext.declaredAs`, `src/Phase.ts`). Never
 * a heuristic of the package's own over a commit range, a final message, or a
 * tag it has seen before (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 *
 * **The declaration key is what keeps this a refusal rather than a drop, and
 * what scopes it to the reconciliation it is waiting for.** A clean exit is a
 * producer's to answer — drop the entry, re-scope it, answer its question — so
 * the refusal lifts on exactly that: a rewrite hashes to a new key, and a drop
 * takes the record with the entry. It does *not* lift on a tip that happened to
 * move, which is what keying on the record's `headSha` anchor made it do — an
 * operator commit, or any sibling entry shipping, re-offered the same
 * unreconciled entry to a build wave with nothing new to read. The entry is
 * meanwhile still in the queue and still `open`, and the standing record wakes
 * the slice that drains records through the same classification
 * (`inboxWindow.ts`), so the producer this waits on is woken by the refusal
 * itself.
 *
 * A first attempt carries no record, so an entry nothing has walled on is
 * never refused here.
 */
export function defaultRefusesEntry(ctx: EntryRefusalContext): boolean {
  const prior = ctx.priorAttempt;
  if (prior === undefined) return false;
  return (
    RESOLVED_BY_A_PRODUCER[prior.mode] && prior.declaredAs === ctx.declaredAs
  );
}

/**
 * Whether a standing refusal only a plan slice can resolve is keyed to an
 * entry this tick's queue still carries.
 *
 * **This is the inbox slice's own liveness question, over the inbox slice's
 * own evidence.** The engine reports the record store as the tick left it
 * (`TickResult.priorAttempts`) beside the queue it left
 * (`pendingAfter`), so the handoff asks {@link standingRefusals} — the one
 * function that slice's window asks — rather than rebuilding the answer from
 * the wave's `noCommit` and each entry's `mergeOutcome`. Those two fields
 * are the fates the engine *stamped onto* the records being read here, so
 * routing on them was the engine's own classification respelled by the
 * package (`.claude/rules/engineering.md`, *A fact the engine holds is
 * reported, never rediscovered*).
 *
 * Reading the store rather than this tick's fates also widens the leg in the
 * one direction that was a hole: a refusal a *previous* wave left standing
 * is still waiting on a producer, and a wave that shipped something else
 * reported nothing about it. The record is what outlives the tick.
 *
 * It puts the inbox in the wake set; it never takes build out of it.
 * Re-dispatching the walled entry is what {@link defaultRefusesEntry} holds
 * back, per entry, and the wave still has every other pickable entry to ship.
 */
function refusedForPlan(result: TickResult): boolean {
  return standingRefusals(result.pendingAfter, result.priorAttempts).length > 0;
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
 * The set itself: every slice whose window is live, plus build while
 * anything is pickable. An empty answer is hibernation.
 *
 * **The one exception is the slice that just ran and committed nothing.** It
 * made no progress, so its window is open for exactly the reason it was open
 * last tick, and naming itself would spend every remaining tick of the loop
 * on the same wall — an unroutable record, a refused render. Excluded, it
 * costs one tick. A slice that *did* commit and is still live re-wakes
 * itself: that window is larger than one tick's budget, which is progress.
 *
 * The exception is read off the phase the engine says produced this result,
 * so it lands on a slice and never on build: a wave's repeat is held back
 * per entry instead ({@link defaultRefusesEntry}), and a wave that committed
 * nothing because a gate reverted it is exactly the one the next tick should
 * carry from its new base.
 */
function wakeSet(
  slices: readonly HandoffSlice[],
  window: SliceWindow,
  result: TickResult,
): string[] {
  const walled = result.committed ? undefined : result.phaseName;
  const refused =
    result.phaseName === BUILD_PHASE && refusedForPlan(result);
  const woken = slices
    .filter(
      (slice) =>
        slice.name !== walled &&
        (slice.live(window) || (refused && slice.name === INBOX_PHASE)),
    )
    .map((slice) => slice.name);
  return window.pickable ? [...woken, BUILD_PHASE] : woken;
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
 * nowhere to wake without it, and the alternatives are both silent: naming a
 * phase the chain does not carry, or leaving a wave's refusal in front of no
 * producer for the rest of the run
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
    // the queue still reports it and the set names the inbox once more. That
    // costs one declined tick — the next tick's `shouldRun` reads a queue
    // that now resolves, says no before anything is provisioned, and its own
    // handoff routes on from there. The alternative is a handoff guessing
    // from `pickableAfter` whether a repair landed, which is the inference
    // this module does not make (`.claude/rules/engine-boundary.md`, *Told,
    // not inferred*).
    const window: SliceWindow = {
      flumeDir: result.flumeDir,
      pickable: result.pickableAfter.length > 0,
      ...(result.queueParseFailure
        ? { queueParseFailure: result.queueParseFailure }
        : {}),
    };

    return wakeSet(slices, window, result);
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
  /** The plan slices the wake set may name, in order. */
  readonly slices: readonly HandoffSlice[];
}

/**
 * A declared handoff under the package's floor: the one write the default
 * makes, and then the consumer's own answer about which phases wake.
 *
 * The wake set is the consumer's to replace; the stop write is not. A wave
 * that shipped an entry marked {@link CONTRACT_TOUCHING_FIELD} has to end
 * the run whoever schedules the phases after it — the reason the write
 * exists is a supervisor resident at a contract that commit just changed
 * ({@link stopAfterContractTouchingShip}), and that stays true when a
 * consumer names build's next phases itself. Nothing about declaring a
 * handoff is a request to opt out of the package's own entry extension.
 *
 * The per-entry refusal is this same floor on the other surface, installed
 * on the chain rather than on a phase (`chain.ts`) — which is why neither is
 * something a declaration can displace by replacing this one.
 */
function beneathTheFloor(declared: Handoff): Handoff {
  return (result: TickResult): string[] => {
    stopAfterContractTouchingShip(result);
    return declared(result);
  };
}

/**
 * The handoff one phase runs with: the consumer's declared one when it
 * declared one for that phase, else the package's default.
 *
 * **The wake set is replaced, never composed.** A declared handoff is the
 * whole decision about which phases wake — the package does not compute its
 * own set first and let a declaration amend it, because a handoff that only
 * sometimes decides is a consumer reasoning about two of them instead of
 * one. Per phase rather than wholesale, so overriding build's routing does
 * not force a consumer to copy the slice set it did not want to change —
 * copying is exactly what the override exists to avoid (`spec/harness.md`,
 * *The default `handoff`*).
 *
 * What a declaration does not replace is the floor beneath it
 * ({@link beneathTheFloor}).
 *
 * The default is constructed only where no declaration displaces it, so a
 * consumer that declared a handoff for every phase never meets its refusal.
 */
export function resolveHandoff(options: ResolveHandoffOptions): Handoff {
  const declared = options.declared?.[options.phase];
  return declared ? beneathTheFloor(declared) : defaultHandoff(options.slices);
}
