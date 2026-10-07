/**
 * How a span over the queue is read and spelled for the `flume status`
 * listing — one home for the two rows that measure one (`flowLine`,
 * `src/queueFlow.ts`; `goalRows`, `src/queueGoals.ts`).
 *
 * One job: turn a filing read and an instant into either a span or the
 * statement that there is none, and spell a span the one way this listing
 * spells one. Here rather than beside either row, because a listing that
 * spells the median filing→ship span one way and how long a goal has stood
 * another is two vocabularies on one screen, and the second copy is the one
 * that drifts (`.claude/rules/engineering.md`, *The fix lands at the
 * mechanism*).
 */

/**
 * A wall-clock span at the coarsest unit that still states it — seconds,
 * minutes, hours, then days.
 *
 * Not `formatElapsed` (`src/budgetLine.ts`), which spells the same kind of
 * value for a different range: that line is a session's own clock and tops
 * out at hours, where a queue span is routinely days and would read as
 * `73h 5m`. Two ranges, two spellings, neither reaching past its own
 * surface.
 */
export function formatSpan(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * The span between a filing read in unix seconds and an instant in
 * milliseconds, or `undefined` when the pair is no span at all.
 *
 * Two readings are declined rather than folded into a number. An instant that
 * will not parse is a history line this engine cannot date — `Date.parse`
 * answers `NaN`, and arithmetic over it would carry silently into a median as
 * a `NaN` the whole figure then reads as. And a span that runs backwards is a
 * filing commit git timed after the moment measured against it, which is a
 * host clock that moved between the two writes rather than a queue that
 * shipped before it filed. Either way the pair is no measurement, and the
 * figure folded from it says what it was measured over
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function spanFrom(
  filedAtSeconds: number,
  toMs: number,
): number | undefined {
  const ms = toMs - filedAtSeconds * 1000;
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}
