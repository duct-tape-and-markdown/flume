# `TickResult.gateResults` does not actually erase `details`

Shipped as written. One thing observed while pinning the recorded row.

`src/Dispatcher.ts:86-91` declares `GateResultEntry` as the "local-mutable
shape for accumulating gate results before they widen to
`TickResult.gateResults` (which erases `details`)". It doesn't. `TickResult`'s
type (`src/Phase.ts:57`) omits `details`, but the dispatcher hands the *same*
array through at `src/Dispatcher.ts:2313` (and `:3453`, `:3470`) with no
structural copy — so at runtime a failing gate's `details` rides on
`result.gateResults` for every handoff consumer, typed away rather than erased.

Now visible: `tests/Dispatcher.test.ts` "a gate that throws is recorded as
that gate's failure carrying the error's message" asserts
`outcome.result?.gateResults[0]` with `details` present, and passes.

Two forks, both plan's call: either the prose is wrong (drop "erases", and
decide whether `TickResult.gateResults` should type the field it carries), or
the erasure is intended and missing (widen with an explicit projection).
Engineering.md *Narration is the ladder's bottom rung* — prose asserting a
property nothing holds.
