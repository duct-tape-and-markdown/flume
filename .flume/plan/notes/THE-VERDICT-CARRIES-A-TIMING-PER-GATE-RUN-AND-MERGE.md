# Timings shipped; the verdict's shape reader now refuses older rows

Three observations.

**Every pre-commit verdict on disk now reads as "not a verdict."**
`isTickVerdict` (`src/tickVerdict.ts`) requires `timings` beside the other
required arrays, so `tick-verdicts.jsonl` rows written before this commit are
skipped: `flume status` spend loses its window and `readLatestVerdictsSync`
hands `shouldRun` no anchor until each phase ticks once. Pre-1.0 in-place
posture (`spec-plan-build.md`), self-healing after one tick per phase — but
it is a real one-run blind spot in this repo's own loop, worth knowing when
reading the next `status`.

**The merge row is the whole ship-lock span, gates included.** One row per
`mergeAttempt` call (fanout) and per committed singleton merge: the lock a
sibling may hold, the pick, the afterMerge gates, the revert or the ship
consult. The gate rows beside it are its breakdown, so gate time is counted
twice if a reader sums the array — deliberate, stated at both sites, but a
renderer summing `timings` needs to know it. The ledger rewrite
(`closeWaveMerge`) gets no row: per the entry, the row rides `mergeAttempt`.

**`flume verdict` renders nothing of this.** `src/cliVerdict.ts` prints the
invocation usage line and no timings; the entry called that rendering
unspecced and out of scope, so the field lands with no CLI surface. If the
point of measuring non-agent time is an operator reading it, the render is a
follow-up entry — and it is the natural place to decide whether the sum
double-counts (above) or the renderer subtracts.
