/**
 * The live run's agent spend — which of the usage rows on disk are *this*
 * run's, and how many agents it started that have not left one yet.
 *
 * One job, and it is a read: `flume status` line 7 (spec/cli.md, "`flume
 * status` owes exactly this") owes a number that includes the tick currently
 * running, and a tick's rows reach two places at two times — the per-phase
 * rows file as each agent returns (`<flumeDir>/invocations/<phase>.jsonl`),
 * then the verdict history log when that tick settles. Reading either alone
 * is wrong in a way an operator cannot see: the log alone reports a live wave
 * as its last *finished* tick, and the rows files alone lose every tick the
 * run already closed. Composing the two is the job held here rather than
 * inside the verb, which prints rows and derives none of them
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * Facts, never a verdict: this says what was spent and what has not reported
 * back. Whether that is too much is the operator's and the chain's
 * (`.claude/rules/engine-boundary.md`).
 */

import {
  RENDERED_PROMPT_PREFIX,
  renderedPromptName,
  renderedPromptNames,
  runWindowStamp,
  withinRunWindow,
} from "./renderedPrompts.js";
import {
  readAllInvocationRows,
  readTickVerdicts,
  totalAgentUsageByPhase,
  type PhaseAgentUsage,
  type PhaseInvocations,
} from "./tickVerdict.js";

/** What a live run has paid for so far, and what it is still waiting on. */
export interface RunSpend {
  /** Every row in the run's window, folded per phase. */
  readonly byPhase: readonly PhaseAgentUsage[];
  /**
   * How many agents the run started whose row is not in {@link byPhase} —
   * one per rendered prompt the run wrote that no row on disk names. Every
   * invocation persists its prompt before `agent.invoke` and its row when
   * that agent returns (spec/prompt.md, *The rendered prompt is persisted
   * before the agent runs*; spec/loop.md, *Every agent invocation leaves a
   * usage row*), so the difference is exactly the set whose cost this total
   * does not yet carry — which is what an operator reading a live number
   * needs told, because otherwise a total two hours stale and a total
   * complete print identically.
   */
  readonly inFlight: number;
}

/**
 * What the run that claimed the loop lock at `startedAtMs` has spent, and how
 * many of its agents have not reported.
 *
 * The window is one predicate over one alphabet, and it is not spelled here:
 * {@link runWindowStamp} renders the edge and {@link withinRunWindow} compares
 * a filename against it, both from `src/renderedPrompts.ts`, where the trim
 * that bounds that same directory takes them too.
 *
 * Refuses rather than under-reporting: a rows file, the history log or the
 * prompts dir that is present and will not read throws, and the verb that
 * called this answers `EX_IOERR`. A run that is paying for agents must never
 * print as one that has spent nothing (`.claude/rules/engineering.md`, *Loud
 * or nothing*).
 */
export async function readRunSpend(
  flumeDir: string,
  startedAtMs: number,
): Promise<RunSpend> {
  const startStamp = runWindowStamp(startedAtMs);
  const log = await readTickVerdicts(flumeDir);
  // Every promptPath the log carries, whatever the verdict's own date: a tick
  // that settled has its rows here *and* still in its phase's rows file,
  // which is cleared only when that phase next ticks. The set is what keeps
  // the live read below from counting those rows a second time — the row's
  // own identity, not a guess from which file it was found in.
  const settled = new Set<string>();
  for (const verdict of log) {
    for (const row of verdict.invocations) settled.add(row.promptPath);
  }
  // Settled ticks of this run, bounded by the instant the supervisor stated.
  const spans: PhaseInvocations[] = log.filter(
    (verdict) => Date.parse(verdict.at) >= startedAtMs,
  );
  // The running ticks: rows their verdict has not been written for yet. Bound
  // by the row's own invocation stamp as well as by the log, because a rows
  // file outlives the tick that wrote it — a tick that died before this run
  // started leaves rows no verdict ever carried, and folding those in would
  // answer a question about this run with another run's money.
  for (const span of await readAllInvocationRows(flumeDir)) {
    const live = span.invocations.filter(
      (row) => !settled.has(row.promptPath) && startedAfter(row, startStamp),
    );
    if (live.length > 0) {
      spans.push({ phaseName: span.phaseName, invocations: live });
    }
  }
  const counted = new Set<string>();
  for (const span of spans) {
    for (const row of span.invocations) counted.add(row.promptPath);
  }
  const started = await renderedPromptNames(flumeDir);
  const inFlight = started.filter(
    (name) =>
      withinRunWindow(name, startStamp) &&
      !counted.has(RENDERED_PROMPT_PREFIX + name),
  ).length;
  return { byPhase: totalAgentUsageByPhase(spans), inFlight };
}

/**
 * Whether `row`'s invocation began at or after `startStamp` — the window's
 * own compare ({@link withinRunWindow}), over the filename the row's
 * `promptPath` names.
 *
 * A `promptPath` this engine did not spell counts as the run's rather than
 * being dropped: the two errors are not symmetric. Dropping a real row
 * under-reports spend, which is the failure this whole line exists to close;
 * keeping a foreign row at worst over-reports a number the rows file's own
 * clear bounds to one tick.
 */
function startedAfter(
  row: { readonly promptPath: string },
  startStamp: string,
): boolean {
  const name = renderedPromptName(row.promptPath);
  return name === undefined || withinRunWindow(name, startStamp);
}
