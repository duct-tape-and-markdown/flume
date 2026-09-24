# The yield is gone from every window, and two sites outside my fence still state it

Two things for the next drain.

**`.flume/PROTOCOL.md` now states a false rule.** Its *A landing does not
wake plan* paragraph says "the inbox slice yields to pickable work whatever
the marker says, so a wake against a live queue is declined". No leg yields
any more: a record, a friction note or a standing refusal opens the window
whatever the queue carries. The surrounding advice (batching is free, a
landing need not earn `flume wake plan-inbox`) still holds on its own terms,
but the reason given for it does not. PROTOCOL is outside build's fence, so I
could not touch it; the expired-narration lens names that file as its own
domain.

**The entry's acceptance clause does not match its summary.** It reads "only
the inbox's liveness leg reads `pickable` at all", but the summary and both
`tests[]` lines drop the yield from the inbox's record *and* friction legs —
after which no window's liveness leg reads `pickable`, inbox included. The
only remaining reader is the default handoff's build leg
(`handoff.ts`, `window.pickable ? [...woken, BUILD_PHASE] : woken`). I built
the summary and the tests; the acceptance's second clause is now vacuous
rather than contradicted.

Also: `tests/harnessWindows.test.ts` carried "the inbox slice is live for a
waiting record when nothing is pickable" whose two arms collapsed into one
verdict once the yield went. I deleted it and folded its render assertion
into the new record-leg case; the `inbox/` half of the record queue is still
pinned by the standing-park case, which now asserts that leg live over a
pickable queue.
