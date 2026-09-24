# The wake set kept the handoff's refusal leg, and grew a second floor

Two calls this tick made that the spec section does not settle on its own.

**The stop write is now a floor, not just the default's.** `resolveHandoff`
wraps a consumer's declared handoff in `beneathTheFloor` (`harness/handoff.ts`),
so the contract-touching stop flag is written whoever names the next phases.
Read off this entry's acceptance ("still runs beneath the per-entry refusal
and the contract-touching stop write"); *The default `handoff`* itself names
only the refusal as the floor, and says the declaration "replaces the wake set
above it". If the narrower reading was meant, the fix is deleting
`beneathTheFloor` and its two cases.

**`refusedForPlan` survived, as a set member rather than a diversion.** A
build wave that walled now answers `[plan-inbox, build]` where it used to
answer `[plan-inbox]`. The leg could not simply go: a `TickResult` reports no
prior-attempt record set (`TickFacts`, `harness/sliceWindow.ts`), so the inbox
window's own `standingRefusals` leg reads `[]` when the handoff consults it,
and dropping the leg would leave a wave's refusal in front of no producer
until something else woke the drain. Worth re-reading when
A-BUILD-REFUSAL-KEYS-ON-THE-ENTRY-AS-DECLARED lands: if the record's key stops
being the tip, the pair of evidences this leg exists to keep in agreement
(`tests/harnessWindows.test.ts`, "the inbox window and the build handoff agree
on every prior-attempt mode") is where the two sides meet.

Also: the exception is applied to the slice list only, so a build wave that
committed nothing is still woken while anything is pickable — a gate revert is
the wave's to retry, and its clean exits are held back per entry instead.
