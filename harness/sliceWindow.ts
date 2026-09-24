/**
 * The vocabulary one plan slice's window is spelled in (`spec/harness.md`,
 * *The phases*): what a tick hands a window, what a window hands back, and
 * the line budget a render works within.
 *
 * Every window in this package and the assembly that collects them
 * (`windows.ts`) is typed from here, so the three slices share one spelling
 * of a tick's facts rather than three that must be kept agreeing
 * (`.claude/rules/engineering.md`, *A module is one job*). The windows
 * themselves live one per file beside this; nothing here reads a tree, a
 * forge or a state root.
 */

import type { PendingEntry } from "../src/PendingSchema.js";
import type { PriorAttempt } from "../src/Prompt.js";

import { INBOX_PHASE, type Declaration, type PlanSlice } from "./declaration.js";
import type { HandoffSlice, SliceWindow } from "./handoff.js";

/**
 * How many lines of diff one window renders before deferring the rest to the
 * next tick.
 *
 * The package's value, like the record cap in `records.ts` and for the same
 * reason: the budget bounds a prompt the package wrote, so it is the
 * package's to size, not a declaration knob a consumer discovers by finding
 * a tick that ran out of context.
 */
export const WINDOW_LINE_BUDGET = 1200;

/**
 * The two facts a tick reports about its own records, as every reader of a
 * window spells them.
 *
 * `pending` and `priorAttempts` are `TickContext`'s own fields, optional here
 * for the reason they are optional there: a hand-built fixture may omit
 * either, and a dispatcher-built context always carries both. Their absence
 * reads as "no standing refusal" — the answer a reader that was handed no
 * store can truthfully give (`standingRefusal.ts`).
 *
 * A window the handoff builds omits them too, and loses nothing by it: the
 * engine reports the same two facts on the `TickResult`
 * (`pendingAfter`/`priorAttempts`), and the handoff's own refusal leg asks
 * `standingRefusals` (`harness/standingRefusal.ts`) of them directly — one
 * classification over one evidence, whichever surface the reader is on
 * (`handoff.ts`).
 */
export interface TickFacts {
  /** The queue as the tick sees it — `TickContext.pending`. */
  readonly pending?: readonly PendingEntry[] | undefined;
  /** Standing prior-attempt records — `TickContext.priorAttempts`. */
  readonly priorAttempts?: ReadonlyMap<string, PriorAttempt> | undefined;
}

/**
 * What a slice's liveness predicate reads — the two facts every tick reports
 * ({@link SliceWindow}), plus the two only a `shouldRun` consult is handed
 * ({@link TickFacts}).
 */
export interface SliceInputs extends SliceWindow, TickFacts {}

/**
 * What rendering a window reads: the tick's own tree, its state root, and the
 * same two facts {@link TickFacts} names.
 *
 * Shaped so a `TickContext` satisfies it as given — the chain factory hands
 * `ctx` straight through rather than unpacking it into a second vocabulary
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*). `cwd`
 * is the tick's provisioned worktree, so git reads the tree the agent is
 * about to work in rather than whatever a sibling wave left at the repo
 * root.
 *
 * The queue's parse failure is `Pick`ed off {@link SliceWindow} rather than
 * declared again here: both readers are handed the same engine fact — the
 * liveness leg off `TickResult`, the render off `TickContext` — and two
 * spellings of one field is the copy that drifts (`.claude/rules/engineering.md`,
 * *Derived state is computed, never restated beside its source*).
 */
export interface WindowContext
  extends TickFacts,
    Pick<SliceWindow, "queueParseFailure"> {
  /** The tick's working tree — `TickContext.cwd`. */
  readonly cwd: string;
  /** The tick's resolved state root — `TickContext.flumeDir`. */
  readonly flumeDir: string;
}

/**
 * The `{{…}}` keys each slice's {@link PlanSliceWindow.args} returns.
 *
 * **Every one of them is data.** A window renders material the package did
 * not author — a record an operator left, a prior-attempt record's own JSON,
 * a spec diff, a deleted line off the retired-claim delta — and the engine's
 * renderer scans substituted text for inline-exec spans (`spec/prompt.md`,
 * *The render pipeline*). A spec diff that touches the section documenting
 * that grammar carries a span verbatim, so an undeclared key here is a plan
 * tick refused by a command the material only quoted.
 *
 * Keyed exhaustively by {@link PlanSlice} and read as each window's `args`
 * return type, so a slice added without its keys is a typecheck failure and a
 * key added to a window without being named here is another
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export const SLICE_DATA_KEYS = {
  [INBOX_PHASE]: [
    "QUEUE_PARSE_FAILURE",
    "RECORDS",
    "BUILD_RECORDS",
    "CI_LANES",
  ],
  "plan-derive": ["SPEC_WINDOW"],
  "plan-sweep": ["SWEEP_WINDOW"],
} as const satisfies Record<PlanSlice, readonly string[]>;

/** The argument map one slice's window returns. */
export type SliceArgs<S extends PlanSlice> = Record<
  (typeof SLICE_DATA_KEYS)[S][number],
  string
>;

/**
 * One plan slice's window: the {@link HandoffSlice} the wake set reads, plus
 * the prompt arguments that slice's own prompt names.
 *
 * `args` returns a map rather than a single string because the inbox slice's
 * prompt names several — the queue's parse failure, the records queue, the
 * standing build refusals and the CI lanes are separate blocks in it, and
 * collapsing them into one arg would make the prompt's sections ones the
 * agent has to split by eye.
 */
export interface PlanSliceWindow extends HandoffSlice {
  readonly name: PlanSlice;
  readonly live: (inputs: SliceInputs) => boolean;
  /** The `{{…}}` arguments this slice's prompt is rendered with, for one tick. */
  readonly args: (ctx: WindowContext) => Record<string, string>;
  /**
   * Those same keys, for the phase to declare as `Phase.promptDataKeys` —
   * the window says what it substitutes, the engine neutralizes it, and no
   * package code touches the values on the way through.
   */
  readonly dataKeys: readonly string[];
}

/** What building a consumer's slice windows needs (`windows.ts`). */
export interface PlanSliceWindowsOptions {
  /** The consumer's validated declaration — its spec locus and its slices. */
  readonly declaration: Declaration;
  /**
   * Where a liveness predicate reads git from. The repo root, because the
   * handoff runs with no worktree of its own and a `TickResult` reports
   * none; a render reads the tick's own `cwd` instead.
   */
  readonly repoRoot: string;
  /**
   * Lines of diff one window renders before deferring the rest, defaulting
   * to {@link WINDOW_LINE_BUDGET}. A seam for a caller that must observe the
   * deferral without minting a budget-sized diff to provoke it.
   */
  readonly budget?: number | undefined;
}

/** The tick's line budget, defaulting to the package's own value. */
export const budgetOf = (options: PlanSliceWindowsOptions): number =>
  options.budget ?? WINDOW_LINE_BUDGET;

/**
 * Whether the queue this tick read resolved — the leg every slice but the
 * inbox's opens behind.
 *
 * Every slice the package builds declares the queue writable, so the engine's
 * carve-out runs any of them over an unparseable queue with an empty `pending`
 * and the failure as a fact (`spec/pending.md`, *Queue reads are strict*). For
 * a slice whose output is a derived queue that is the worst possible input:
 * "derive from nothing" and "derive from a drained queue" render identically,
 * and the rewrite would land as a queue with every entry dropped. Shut, the
 * slice leaves the tick to the inbox, whose window opens on exactly this fact
 * and whose rewrite is the repair (`inboxWindow.ts`; `spec/harness.md`, *The
 * gates the discipline needs*: no state of the queue needs a hand edit).
 *
 * One home for the question rather than the same comparison at each window:
 * the answer is the engine's fact, and a slice added later gets it by calling
 * this rather than by remembering to (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 */
export const queueResolved = (inputs: SliceInputs): boolean =>
  inputs.queueParseFailure === undefined;
