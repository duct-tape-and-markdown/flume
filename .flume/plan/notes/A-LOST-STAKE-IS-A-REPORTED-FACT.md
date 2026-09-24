# The lost-stake case rides `Chain.refusesEntry` as its only mid-selection seam

Two things the next plan tick may want.

**The race has exactly one reachable seam.** `runFanout` reads
`claims.readLive()`, selects, then stakes. Nothing between the read and the
stake is a hook except the chain's `refusesEntry`, which selection consults
per entry — so the new case plants the sibling's claim from inside that
predicate. If a later change moves the claims read after the predicate (or
drops the consult for an entry the batch already holds), the case keeps
passing while exercising nothing. It has a non-vacuity guard (the predicate
was offered `TAKEN`), but that guard would move with the seam.

**The barrel widened by one type I did not plan for.** `StakeLoss.by` is a
`PidClaim`, and the unnamable half of the export pin
(`tests/exportConsumers.test.ts`) reds until every type a reached property
names is exported from an entry module — so `src/index.ts` now re-exports
`PidClaim` too. Any future engine fact carrying a holder, an instant, or any
other internal record shape pays the same toll: the record type *and* every
type it names become public surface in the same commit. Worth knowing when
sizing an entry that says "report fact X on the verdict".

`docs/CHAIN-AUTHORING.md` §13 gained the field; `docs/MIGRATING-0.15.md`
deliberately untouched (migration guides name the surface of their own line).
