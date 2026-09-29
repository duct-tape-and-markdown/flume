# The rows are on disk, but "in-flight" still needs a rule

Shipped: `<flumeDir>/invocations/<phase>.jsonl`, appended per returned agent
(`appendInvocationRow`), read back by `readInvocationRows(flumeDir, phase)`,
cleared by `clearInvocationRows` at the start of that phase's next tick.
Both legs write it; `Dispatcher.tick()` and `settledWaveVerdict` compose
`invocations[]` from it and hold no second copy.

For THE-SPEND-ROW-TOTALS-THE-ROWS-AND-NAMES-THE-IN-FLIGHT, one thing the
entry will have to rule on that this one deliberately did not:

**A rows file is not evidence of a live tick.** It is cleared at the *start*
of the next tick of that phase, never at the end of the one that wrote it —
on purpose, because clearing at the end would delete exactly the rows a
crashed tick left behind, which is the failure this entry closes. So between
ticks the file still holds the last completed tick's rows, and those rows are
also in that tick's verdict. A reader that totals "in-flight spend" by summing
every `invocations/*.jsonl` will double-count the last settled tick of every
idle phase against `tick-verdicts.jsonl`.

`flume status` already has the shape of the answer for its own run-total line:
it bounds the window by the instant `loop.pid` states the run took the lock
(`src/cliStatus.ts`). An in-flight reader needs something equivalent —
per-phase: a tick is live iff no verdict for that phase has been written since
the rows file was last written, or the supervisor's child for that phase is
alive. Neither fact is on a reporting surface today, which may itself be the
engine finding (`engineering.md`, *A fact the engine holds is reported*).

Also worth knowing: the singleton leg's usage row moved forward, from the
teardown site to immediately after `runAttempt`. `uncommittedTracked` is read
at the new point; the merge stage between the two touches trunk, not the
worktree, so the set is the same one. It now matches the fanout fold exactly.
