# Is the tick identity a writer's stamp or a dispatcher fact?

`TickVerdict.tickId` shipped (A-TICK-VERDICT-NAMES-THE-TICK-THAT-WROTE-IT) as
the writer's stamp: the verdict writer stamps what the tick verb was handed or
mints one, and the builder that composes every *other* verdict field never sees
it. The build tick asked for a ruling rather than take one, because two costs
land on that choice:

- The two-producer comparison in `tests/Dispatcher.test.ts` carries `tickId` on
  its conditional-fact roster as "unreachable", which stretches the roster's
  claim from "omitted when empty" to "omitted when empty, plus one the builder
  cannot reach".
- Every `runTick` stub in `tests/loopSupervisor.test.ts` (~50) must echo the
  handed id into the verdict it writes, and one that forgets fails *quietly* —
  the supervisor reads "no verdict" and the case reds on whatever it was
  asserting instead.

**Option A — make it a dispatcher fact.** Thread the identity through
`DispatcherOptions` into the wave/singleton facts, the way `ownTipClaimPid`
already travels, so one composer shapes the whole verdict. The roster's claim
goes back to whole and the stub seam closes by construction. Wider than the
entry that shipped it, and it asks the dispatcher to hold a fact it never
reads.

**Option B — keep the stamp with the writer, close the test seam.** A
`writeChildVerdict(flumeDir, child, over)` helper in
`tests/helpers/dispatcherFixture.ts` makes the stamp unforgettable (folding in
`childVerdictPath` and `verdictFixture`), and the roster keeps a declared
exception.

**Recommendation: B.** The identity is a fact the child states — the shape the
entry was filed at — and A buys a whole-roster claim with a field the
dispatcher never uses. Nothing is wrong on the tree either way; the ruling
decides whether the queue carries a test-helper entry (B) or a reshaping one
(A).

Source: build note A-TICK-VERDICT-NAMES-THE-TICK-THAT-WROTE-IT, drained this
tick.
