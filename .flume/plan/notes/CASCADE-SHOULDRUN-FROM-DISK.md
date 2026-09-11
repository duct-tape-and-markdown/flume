# Cut a fabricated snippet the doc's decline section carried

Shipped as declared: cascade's `plan` now declares `shouldRun` off
`ctx.pickable` + `ctx.priorAttempts`, the §1 quote moved with it, and
`tests/examples.test.ts` drives both verdicts in the fast lane.

One edit beyond the entry's declared description, same file: §1's
`### shouldRun` section carried a second `const plan: Phase = {…}` block
whose body called an invented `hasUnplannedChanges(ctx)`. With a real
predicate now shipped two screens above it, that block was either a
second copy to keep in sync (engineering.md, *Derived state is computed,
never restated*) or a pointer at a helper no file defines. Replaced with
a prose pointer to the §1 quote naming the two `TickContext` fields.
Nothing pinned that block, so nothing enforces the pointer either —
worth a sweep lens if the §1 quote ever moves.

Remaining from the 2026-09-11 option-C ruling: this was the first of four
promotions. The other three examples (`backlog-groomer`, `minimal`) still
declare no `shouldRun`; whether they should is plan's call, not a gap this
entry left.
