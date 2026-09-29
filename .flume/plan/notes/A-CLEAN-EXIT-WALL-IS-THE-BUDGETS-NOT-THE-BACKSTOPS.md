# A clean-exit wall spends the budget and reports as a clean run

Shipped as declared: the `wakeSet` header now splits the two walls it names
(a refused render records a stage failure and reaches the backstop; an
unroutable record is a clean exit and records none, so `tickBudget` is its
only bound), and the pin drives six clean-exit ticks through the real
`superviseLoop` to show the budget is what ends the run.

Observed while pinning it, for plan to route or accept:

The supervisor's `errored` fold (`src/loopSupervisor.ts`) names
`gate-revert`, `platform-preempt` and `render-refused` and deliberately omits
`clean-exit`, so a run whose every tick was a clean exit finishes with
`erroredTicks` empty, `repeatedFailure` undefined, and `hibernated: false`.
`loopExitCode` therefore reads a burn-the-whole-budget run that shipped
nothing exactly like a healthy one. The operator's only signal is the
`reached --max N; stopping` info line — which prints identically for a
productive run that simply ran out of ticks.

That is correct against the spec as written (a clean exit is not a failure),
so it is not a defect I could file myself. But it is the one no-commit mode
with no bound short of the budget and no distinguishing exit status, and the
budget is a whole run. If flume wants an operator-visible difference between
"spent its budget shipping" and "spent its budget walling", the decision is
whether the completion summary should carry a shipped-nothing fact — a fact,
not a verdict, so it would sit on `SuperviseResult` beside `erroredTicks`
rather than in `loopExitCode`. Worth a question rather than an entry: it is
a reporting-surface choice, not a mechanism gap.

No debt found at either site otherwise; the header's other claims still hold
on disk.
