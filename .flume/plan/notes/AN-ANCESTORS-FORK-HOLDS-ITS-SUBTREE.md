# The fork fold landed on one climb; the test file had two `forest` helpers

`isPickableNow` now computes the lineage once and reads
`dependsOnForks` across it before the gate switch reads any gate, so
selection (via `gateEligible`) and tooling got the inheritance from one
change.

Three prose sites carried the old entry-own-only reading and were
widened in the same commit, not just the doc the entry named: the
`dependsOnForks` field doc, `DispatcherOptions.forkResolver`
(`src/Dispatcher.ts`), and `docs/CHAIN-AUTHORING.md` §6 point 1, which
is what a chain author reads before the hover text. `gateEligible`'s
own header named the climb as carrying gates alone and was widened too.

One shape observation for plan: `tests/PendingSchema.test.ts` already
had a module-level `forest()` for the footprint cases, and the
gate-inheritance describe had a second `forest()` of its own shape
inside it. Hoisting the inheritance one so the new fork describe could
reuse it (rather than spelling a third forest builder) collided on the
name, so it is now `childInForest`. Two unrelated helpers under one
name in one file is the signature of a fixture vocabulary that grew per
describe; a sweep of that file for forest/queue builders spelled three
ways would probably find more. Not filed — no behavior rides on it.

No open question. The spec section already stated the fold, so nothing
here needed a decision.
