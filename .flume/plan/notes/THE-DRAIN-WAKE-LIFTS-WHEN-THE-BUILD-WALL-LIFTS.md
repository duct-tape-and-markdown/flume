# The fixtures agreed with a classifier that never asked

The declaration-key leg moved into `isStandingRefusal`
(`harness/standingRefusal.ts`); `defaultRefusesEntry` now adds only "is there
a record at all". Both surfaces lift on the producer's answer.

**Why the drift stood unseen.** Every entry-keyed record fixture in
`tests/harnessHandoff.test.ts` (`entryAnchor`) and `tests/harnessWindows.test.ts`
(`record`) was minted with no `declaredAs` — a shape the real store reads as
absent and never hands a reader (`PriorAttempt.declaredAs`, `src/Prompt.ts`).
So the wake leg's cases judged records the wall could never have judged, and
the two surfaces' agreement case was the only one that stamped the field, by
hand, on top of the helper. Both anchors now derive it through
`entryDeclaredKey` over the entry the tag names, so a fixture cannot mint a
record the writer would not write. Possible lens: **a hand-built fixture for a
record the engine writes is minted through the writer's own derivations, or a
leg the classifier gains is judged over records no store could hold.** Same
family as *A seam gate reads what the real writer wrote*, one rung earlier —
the fixture, not the gate.

**Observed, not filed.** `EntryRefusalContext.declaredAs` (`src/Phase.ts`) now
has no reader inside this repo's package — it stays engine surface a consumer's
own `refusesEntry` reads (`docs/CHAIN-AUTHORING.md`, §12 shows exactly that),
so it earns its place as declared API, not as a caller. Flagging only in case a
later widening of the export pin reaches interface fields and reads it as
residue.

No spec change implied. The `per` section already states the refusal keys on
the entry as declared and that the same record wakes the drain; one
classification is what makes those one sentence rather than two.
