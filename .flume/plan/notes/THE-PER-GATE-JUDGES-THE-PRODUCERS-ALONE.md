# The per gate is the producers' now; one doc roster still reads the old split

Shipped as named. `perGate` joins `goalRankGate` and `newBlockerGate` in
`harnessGates`' producer arm, so build's `afterCommit` set is records,
clean-tree, the pending gate, slice-state, then the consumer's. Three readers
moved with it: the chain test's roster (`per cites resolve` from `SHARED` to
`PRODUCER_ONLY`, so build's lead carrying it reds), build's `DISCIPLINE`
ordering list, and the two per-gate cases, which now read a plan slice's set.
`docs/CHAIN-AUTHORING.md` needed nothing — its pin unions every phase's set.

**Observed, outside this entry's scope.** `docs/MIGRATING-0.16.md` opens its
delete-your-gates section with "Four discipline gates arrive unasked on every
phase — `records`, `clean-tree`, the engine's pending gate, and `per cites
resolve`". That sentence was already wrong before this tick: the set also
holds `slice-state`, `goal rank` and `new blocker resolves`, none of which the
page names. After this tick it is wrong a second way — the one gate it names
beyond the three genuinely uniform ones is the one that just stopped applying
to every phase. Nothing holds it: the roster pin
(`tests/harnessGates.test.ts`, the `docs/CHAIN-AUTHORING.md` case) reads the
authoring page's parenthetical alone, and no pin reads the migration guide.
Whether a 0.16 migration guide should track the current roster at all is the
decision I did not take — it is plausibly frozen on purpose, in which case the
sentence wants scoping to 0.16 rather than updating. Either way it reads as
current truth today.

**Shape tidied in passing.** `goalRankGateOf` and `newBlockerGateOf` had each
spelled its own find-and-throw over `sliceGates`; a third copy was due for the
`per` gate, so all three now go through one `sliceNamed(slice, name)`
(`engineering.md`, *A module is one job*: a helper spelled three times has one
home).
