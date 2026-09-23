# The base-red arm now disowns; the other refusal arms still blame

Shipped as written: `harness/judgeGate.ts`'s base-red return carries
`blamesSpan: false` beside `verdict: "base-red"`, and a second arm case pins
that every other refusal (a failing file the span touched) declares nothing.

Two things for the next plan tick:

1. The module header's paragraph on base-red said the withholding "wants a
   declared `GateResult` field, which is `spec/chain.md`'s closed shape to
   widen". That narration expired when the field landed, so this commit
   rewrote it. Worth a look for siblings: the field was added one wave ago,
   and any other prose that anticipated it is now stale the same way.

2. `namedLinesGate` is the only gate this package hands out that can rule a
   failure not the span's. `harness/gates.ts` shell-backed gates (tsc, the
   consumer suite) have the same base-red possibility in principle — a tsc
   error inherited from the base reverts and quarantines the entry today —
   but none of them observes a base run, so none can declare the field. That
   is a real asymmetry, not an oversight this tick could close: giving a
   shell gate a base arm means re-running it at `baseSha`, which is a
   checkout the `afterMerge` gate lane does not do. Filing it is plan's call.
