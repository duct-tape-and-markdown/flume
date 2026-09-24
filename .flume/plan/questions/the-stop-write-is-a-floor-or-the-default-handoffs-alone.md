# Does a consumer's declared `handoff` inherit the contract-touching stop write?

`THE-DEFAULT-HANDOFF-WAKES-EVERY-LIVE-SLICE` shipped `beneathTheFloor`
(`harness/handoff.ts:442`), which wraps a consumer's declared handoff so the
stop flag is written after a contract-touching ship **whoever names the next
phases**. It was built off that entry's acceptance ("still runs beneath the
per-entry refusal and the contract-touching stop write").

`spec/harness.md`, *The default `handoff`* does not say that. It names the
**per-entry refusal** as the floor — "That refusal is the package's floor: a
consumer's declared `handoff` replaces the wake set above it and runs beneath
the refusal" — and describes the stop write as something the *default* handoff
does ("Reads the engine's reported pickable set ... and writes exactly one
thing: the stop flag").

**Recommendation, not a fork.** Keep `beneathTheFloor` and widen the spec
sentence to name both floors. The narrow reading means a consumer that declares
a handoff silently loses the run-ends-on-a-contract-change property — a resident
supervisor absorbing a contract its children no longer share, which is the
degradation `.claude/rules/engineering.md`, *Loud or nothing* refuses. The
property is not a wake-set opinion a consumer would want to choose about; it is
the same safety the per-entry refusal is, on the other surface.

If the narrow reading *was* meant, the fix is deleting `beneathTheFloor` and
its two cases — and then the spec should say out loud that declaring a handoff
opts out of the stop write, because nothing else would tell a chain author.
