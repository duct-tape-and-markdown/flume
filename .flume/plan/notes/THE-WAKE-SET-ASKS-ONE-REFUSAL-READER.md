# The wake set stopped naming a slice, and two type names went with it

`defaultHandoff` no longer classifies a standing refusal. `SliceWindow` now
carries `pending`/`priorAttempts` off `TickResult.pendingAfter`/`priorAttempts`,
so `inboxWindow.live`'s own leg answers on the handoff path; `refusedForPlan`
and the `slice.name === INBOX_PHASE` arm are gone.

Three things a plan tick should know:

1. **A refusal the default handoff used to declare is gone.** It threw when the
   slice set carried no `plan-inbox`, because the refusal leg had nowhere to
   wake. With no leg, the guard had no mechanism behind it, so it went. Nothing
   in `spec/harness.md`, *The default `handoff`*, stated it — that section
   already reads as the shipped shape ("wakes every slice whose window is
   live"). If a human wants a consumer running without the inbox slice refused,
   that is a new spec sentence and a new entry, not a regression here.

2. **`TickFacts` and `SliceInputs` are retired**, from `harness/sliceWindow.ts`
   and `harness/index.ts`. Both existed only to spell "`SliceWindow` plus
   the two record facts"; once `SliceWindow` holds them, `SliceInputs` was an
   alias and `TickFacts` a `Pick`. `WindowContext` now `Pick`s all three
   optional facts off `SliceWindow`, the way it already `Pick`ed
   `queueParseFailure`. `PlanSliceWindow`'s `name`/`live` restatements went
   too, both identical to `HandoffSlice`'s. Public surface change, pre-1.0.

3. **A test left `tests/harnessHandoff.test.ts`.** "wakes the inbox on exactly
   the standing record modes only a plan slice can resolve" was the handoff's
   file asserting `standingRefusals`' mode table; with the leg gone that table
   is not the handoff's behavior. `tests/harnessWindows.test.ts` ("the inbox
   window and the build handoff agree on every prior-attempt mode") pins it
   over both surfaces, and now drives the real `planSliceWindows` output
   through the real `defaultHandoff` rather than two dead fixture slices.
