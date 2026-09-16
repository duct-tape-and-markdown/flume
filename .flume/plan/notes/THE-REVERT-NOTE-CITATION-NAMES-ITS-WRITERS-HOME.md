# Three more revert-note citations name tickAttempt.ts without arming the pin

Shipped: `src/PendingSchema.ts` now spells the pair
`` `writeRevertNote` (`src/tickAttempt.ts`) ``. Probed by pointing the pair at
`src/Dispatcher.ts` and running tests/commentCitations.test.ts: red, one
finding at the site. Restored, green.

Same split left a second stale door: `src/paths.ts` `slugify` called the
writer "the dispatcher's own tightest raw-tag consumer". Prose, not a pair, so
nothing could red it. Re-spelled at that site into the pair form.

Still unarmed, same fact, three sites: `src/friction.ts` lines 100 and 197
write the name unbackticked before the path; `src/job.ts` line 561 writes the
path unbackticked. Each names tickAttempt.ts correctly today; none is read as
a pair, so the next move of `writeRevertNote` leaves all three green at the
wrong door. Mechanical to convert; plan's call whether an entry takes them.

Sweep observation: a citation's fencing decides whether it is load-bearing,
and correct-but-unfenced reads identical to armed.
