# The claim leg landed in the walk; two spellings of "no claim" remain

`standingRefusals` now takes the claimed set as a fourth argument and skips a
queued entry whose tag is in it, so the liveness leg and the build-records
mark both withhold through one walk. `isStandingRefusal` is untouched, so
`defaultRefusesEntry` still walls a claimed entry's wave — asserted in the new
liveness case.

Two things the next plan tick may want:

1. **Two spellings of an absent claimed set among siblings.**
   `harness/inboxWindow.ts` hands `recordsPending` `inputs.claimed ?? []` while
   the refusal leg hands `standingRefusals` `inputs.claimed` straight through,
   because `records.ts` defaults the parameter to `[]` and this walk takes
   `readonly string[] | undefined` like its two neighbours. One vocabulary for
   "nothing in flight" across the three readers of that set would drop the
   `??` at the call site; pure shape, no behavior
   (`.claude/rules/engineering.md`, *A module is one job*).

2. **Three of `standingRefusals`'s four arguments are now optional
   positionals.** Every real caller already holds a `SliceWindow` or a
   `WindowContext`, both of which carry all three fields. A reader taking that
   surface instead of four positionals would make a forgotten argument
   unspellable rather than merely typed; filed here rather than done, since it
   touches `tests/harnessHandoff.test.ts`, whose `refusalReader` drives the
   walk directly, and the change claims no property.

Also updated: the four `standingRefusals` call sites in
`tests/harnessHandoff.test.ts` pass the result's own `claimedTags` (or the
window's `claimed`), so the fixtures read the three engine facts off one
surface rather than two of them.
