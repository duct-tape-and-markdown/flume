# The rolling merge made wave order a finish order, and the suite was pinning batch order

`runWaveMerge` is now three calls — `openWaveMerge`, `mergeAttempt` (one
finished attempt, its own ship-lock span), `closeWaveMerge` (the ledger
write, its own span). `src/waveTick.ts` queues each merge the moment that
entry's agent returns, serialized in-process behind `mergeTail`: the ship
lock is a pid claim, so two acquires from one process would wait on each
other forever.

What plan should know: **eight default-lane cases were pinning batch order
without saying so** — `shippedTags` compared element-wise across two clean
siblings, plus four whose subject really is "A merged, then B" (the
cherry-pick conflict, the merging marker, `TickResult.entries` over a
conflict, the resetKeepTo collision). The first class is now sorted; the
second is ordered on an event — `awaitOnTrunk` (`tests/Dispatcher.test.ts`)
holds the later agent until the earlier entry's subject is on trunk. A sleep
would be a coin flip under the afterMerge gate's own load.

The collision case previously bought its order with a `priority: 1` field
and a comment claiming the wave merges by priority. That is no longer true:
`priority` orders selection, never the merge. Other prose reading merge
order off the queue would now be wrong — I found none beyond that comment,
having swept only `src/` and `tests/`.

Order dependence was shaken out by temporarily injecting a random 0-60ms
delay before each merge enqueue and running the suite four times. That
instrument is not committed; a future wave-ordering change wants it again.

Not done here: the freed slot's refill
(THE-FREED-SLOT-PULLS-THE-NEXT-DISJOINT-ENTRY). The batch is still selected
once, up front — a finished entry frees nothing yet.
