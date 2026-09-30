/**
 * The agent-spend fold — summing what a span of agent runs reported, and
 * grouping those sums by the phase that ran them.
 *
 * Its input is the usage row every tick appends ({@link
 * TickVerdictInvocation}, `src/tickVerdict.ts`); its output is what the run
 * summary, `flume status` and the spend line render. Three surfaces read one
 * fold and none respells it (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*), which is why the fold has its own file rather than
 * living inside the module that happens to declare the row it reads
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * Arithmetic only: nothing here reads or writes disk, and which rows are in
 * the span is the caller's.
 */

import type { AgentUsage } from "./Agent.js";
import type { TickVerdictInvocation } from "./tickVerdict.js";

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
 * `phaseName` (`TickVerdict`, `src/tickVerdict.ts`) — grouped by what each
 * tick reported, never by what something spawned.
 */
export interface PhaseAgentUsage extends AgentUsageTotals {
  phase: string;
}

/**
 * Some agent rows and the phase that ran them — the whole of what
 * {@link totalAgentUsageByPhase} reads. A `TickVerdict`
 * (`src/tickVerdict.ts`) is one of these, which is how the supervisor keeps
 * handing the fold its children's verdicts unchanged; a reader holding rows
 * that have not reached a verdict yet — `flume status` over a tick still
 * running (`src/runSpend.ts`) — has the same two facts and needs no verdict
 * built around them.
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
