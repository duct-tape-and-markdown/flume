# The floor is pinned; the ladder's own refusal is still default-only

Shipped: the pin drives a chain built from a declaration carrying
`handoff.build`, asserts the ladder really is displaced for that phase, then
reads `refusesEntry` off the same chain. `harness/chain.ts` now points at the
section instead of arguing the rationale.

Observed while wiring it: `resolveHandoff` constructs the default lazily, so
a consumer declaring a handoff for *every* phase never runs `defaultHandoff`
at all — and so never meets its refusal of a slice set with no inbox slice.
The floor is unaffected (it is the chain's `refusesEntry`, not the ladder's),
which is exactly what this pin now holds. But "declared everywhere" is a
configuration whose only guard against a missing inbox slice is that refusal,
and nothing constructs it. Plan's call; the alternative is a load-time
check on the slice set rather than one inside the default ladder.

Two test-local fixtures (`REFUSAL_ENTRY`, `cleanExit`) and a `refusalOf`
helper hoisted to module scope in `tests/harnessChain.test.ts`, so the two
refusal cases share one vocabulary rather than a second copy.
