# The shed drops blank lines, and that is what buys the budget

The entry named the job/step/timestamp prefix and ANSI. Shedding only those
buys nothing: the budget counts lines, and a prefix never costs a line. What
costs lines is the frame around content that is empty — a blank log line the
forge still stamps, and a bare `##[endgroup]`. So `shed` in `harness/ci.ts`
also strips the `##[...]` workflow-command marker (keeping its message, so
`##[error]Process completed…` survives) and drops any line left holding
nothing.

The cost: a suite's blank lines between failures are gone, so failing blocks
now run together. Acceptable for keying findings by title; if a drain ever
reports titles it could not separate, collapsing runs of blanks to one is the
knob, not a bigger budget.

Unrelated and still standing: `windows.ts`'s `renderCiLanes` note that the
stamp leg (`drainedRuns`, liveness over a red lane) is unshipped — a lane
still renders only on a tick the records or refusals already woke.
