# The reading's window is one denominator, and the crossing moved to tokens

Shipped as filed: `BudgetReading` names `contextWindow` and
`priorContextTokens`; both fractions are gone. `budgetLineDue` takes the
crossing in tokens (`contextTokens >= threshold * contextWindow`), and
`budgetLineFrom` divides at the one site that rounds a percentage.

Two things for the next derive.

1. `budgetLineDue` reads the window off the **reading**, not off the
   `BudgetDeclaration` it is also handed — even though the hook seam sets
   the reading's window from that same declaration
   (`budgetHookOutcome` passes `budget.contextWindow` into
   `readBudgetLine`). Deliberate: numerator and denominator then come from
   one value, so a reading composed windowless can never be scored against
   a stray window a caller supplied separately. It does leave the same
   number reachable by two paths at that seam. If plan reads that as the
   restatement this entry was about, the fix is the converse of what
   shipped — drop `contextWindow` from the reading and score against
   `budget.contextWindow` — and the two are one small edit apart. I did not
   file it; I do not think both copies are live state, since one is the
   input to the other.

2. The surviving windowless arm in `budgetLineDue` is reachable, unlike the
   one that went: a chain declaring no window declares no thresholds
   (`validateBudget`), so the arm answers a real reading rather than an
   uncomposable one. `budgetHook.test.ts`'s cadence case already drives it
   (`toolCalls: 0`, empty declaration). The case that drove the old
   impossible state is replaced by a windowed reading with no prior
   context — a transcript's first turn already past a threshold, which
   re-reports rather than swallows.

Behavior-free as predicted: no line text changed, and `162,000/200,000` in
the crossing test is the old `0.81` in the tokens the reading now carries.
