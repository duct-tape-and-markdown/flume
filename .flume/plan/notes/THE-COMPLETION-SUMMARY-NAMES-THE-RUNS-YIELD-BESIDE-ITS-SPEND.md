# The yield segment landed; three facts left unpinned

Shipped: `loopCompletionSummary` (`src/cliVerdict.ts`) now splices a yield
segment - `shipped A, B` or `shipped nothing` - into every line it emits,
at the index the old errored-branch prefix sat at (after the stop/abort
segments, before the errored one, spend still last).

1. **Order was a judgment call.** Keeping the yield where the old prefix
   was means it reads ahead of `N tick(s) errored`, while the doc comment
   says "an error or an abort is what an operator reads first". That was
   already true of the old `shipped ...; N tick(s) errored` prefix, so
   nothing regressed - but if the intended reading order is
   why-it-ended / what-broke / what-it-yielded / what-it-cost, the splice
   index is a one-line move plus three expected strings.

2. **A run that shipped with no errors and no spend still prints nothing.**
   Unreachable in practice (a ship implies an agent invocation, which
   leaves a usage row, which makes `agentUsageByPhase` non-empty), so the
   yield cannot be the sole reason for a line. That implication is nowhere
   pinned; if it should be, the pin belongs against the supervisor's fold,
   not this renderer.

3. **`shipped <tags>` is spelled twice.** Here for the run, and at
   `src/Dispatcher.ts:1501` for a tick. Different sentences (one is a
   run-level yield, one is a tick summary), so not filed - noting it in
   case the family recurs.

Also updated `tests/cli.test.ts`'s log-stamping filter, which keyed
supervisor lines off the literal `[flume] agent usage:` - the spend is no
longer what opens that line. A consumer matching the leading bytes of a
composed line is the fragile shape; it now matches `[flume]` and
`agent usage:` separately.
