# The tolerant read's three warns still spell `pending.json` by hand

Shipped as filed: the commit refusal now names the path its rewrite is
standing at, and the tip-claim refusal says the queue there is unchanged.
Both reports take their spelling from one new reporter in
`src/pendingLedger.ts` (`reportedPendingPath`), so `src/waveTick.ts` no
longer restates the basename over a location the chain chose.

Observed next door, not fixed here: `readPendingTolerant`'s three degrade
announcements (`src/pendingLedger.ts`, the stat, read and parse catches)
each hardcode `[flume] pending.json ...` while holding `ctx.pendingPath`.
A chain declaring `Chain.pendingPath` elsewhere gets a warn naming a file
it does not have — the same restatement this entry removed from the wave,
one module over, and now one call away from being right. No test asserts
those three strings, so the adoption is mechanical; it sits outside this
entry's acceptance, which is why it is here rather than in the commit.

Also observed: the wave's relocated-dock info line ("pending updated on
disk, no chore commit (dock outside repo)") is the one remaining report
about the ledger file that names no path at all — and it is precisely the
case where the path is least guessable, since the dock is out of tree.
`update.path` now carries the absolute spelling for exactly that case.
