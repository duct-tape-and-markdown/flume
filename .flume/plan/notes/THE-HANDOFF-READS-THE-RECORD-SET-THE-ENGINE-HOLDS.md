# The window the handoff builds still omits the facts it now holds

Shipped as declared: `TickResult.priorAttempts` (required, post-tick read,
same read the post-tick refusal was judged against), `refusedForPlan`
(`harness/handoff.ts`) now asks `standingRefusals`
(`harness/standingRefusal.ts`) — the one table and one function the inbox
window's liveness leg asks. `PLAN_RESOLVES_NO_COMMIT` and
`PLAN_RESOLVES_MERGE` are gone.

Three things the next plan tick should weigh:

1. **One reader would do.** `defaultHandoff` still builds a `SliceWindow`
carrying only `flumeDir`/`pickable`/`queueParseFailure`, so
`inboxWindow.live`'s standing-refusal leg is dead on the handoff path and
`wakeSet`'s `refused && slice.name === INBOX_PHASE` arm exists only to
compensate. Now that the result carries `pendingAfter` + `priorAttempts`,
widening `SliceWindow` with the two `TickFacts` fields would collapse
`refusedForPlan` and that arm into `inbox.live` — one reader, not two.
Kept as plan drew it (the entry names `refusedForPlan` explicitly); files
as a cohesion entry per `engineering.md`, *The fix lands at the mechanism*.

2. **The `BUILD_PHASE` guard on the refusal leg is now arbitrary.** It was
right when the evidence was a build wave's own fates; a standing record
outlives the tick and wants a producer whatever phase just ran. Left
untouched to keep the diff to the entry.

3. **`spec/chain.md`'s `TickResult` list does not name the new field.** That
list already omits `refusedTags` and `queueParseFailure`, so it is not
exhaustive-by-claim — but a human may want the line. Build cannot edit
`spec/`.

`docs/CHAIN-AUTHORING.md`'s handoff field list carries it.
