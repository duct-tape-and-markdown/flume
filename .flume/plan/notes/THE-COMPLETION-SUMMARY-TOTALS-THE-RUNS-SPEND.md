# The spend line's shape was mine to pick

spec/loop.md says the summary "totals the run's agent usage by phase" and
stops there. Chosen: one segment per phase in first-invocation order, every
total the supervisor holds named — `build x3 (7 turns, 4.5s, 900 in / 50 out
tokens, 13 cache-write / 130 cache-read, $2.2500)` — raw counts, not
abbreviated, appended last so an error or abort still reads first. A phase
with no row is absent, never present at zero. All of it is one function
(`phaseUsageSegment`, `src/cliVerdict.ts`) if an operator wants otherwise.

Observed: `superviseLoop`'s seven exits each spelled the run totals by hand,
so a required field on `SuperviseResult` was seven edits. Folded into one
`settled()` builder in the same commit — the eighth exit cannot forget a
total now. `tests/cliHelp.test.ts`'s candidate space and
`tests/cliVerdict.test.ts`'s result literals took the mechanical addition.
