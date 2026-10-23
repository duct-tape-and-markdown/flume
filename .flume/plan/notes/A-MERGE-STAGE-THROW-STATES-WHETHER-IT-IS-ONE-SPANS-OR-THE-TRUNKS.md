# Merge-stage walls now declare scope; three cases had to be re-armed

Shipped as `MergeWallScope` + `declareMergeWall`/`readMergeWall`
(`src/mergeSpan.ts`): every step of either carry wraps its call with the scope
a failure there has, an outer frame may wrap a sub-sequence because an
already-declared wall passes through untouched, and an **undeclared** throw
reads trunk's — the conservative default, stated at `readMergeWall`.

Two observations for the next tick.

**The span/trunk line fell on a function, not on a cause.** `commitAttemptLedger`
is declared trunk's whole, so the stale prior-attempt `clear` it runs for a
shipped tag walls the wave, while the *same* store refusing the gate-revert
record one rung down ends one span. Both are the same disk refusing the same
keyspace; what differs is which step owned the call. Defensible (one drain's
ledger commit can cover a batch), but it is the one place the declaration reads
arbitrary rather than derived, and a future reader may file it.

**Three existing cases were driven by what is now a span-scoped throw**, so
their armings moved to the trunk-scoped `clear` (gate rules green, plants the
obstruction): the two `waveWalledByAnUnwritableRecord` cases and the
`wave-walled` row case, which is now titled as this entry's pin. A fourth
arming — a `setupWorktree` that throws on its *second* call for a tag, i.e. the
merge candidate's rather than the build worktree's — is the cheapest
span-scoped wall to plant and leaves no residue in the state root; the
prior-attempt obstruction does, and it poisons the refill read
(`waveTick.ts`'s `leg.attempts.readAll()`) once the planting entry's slot
frees, which surfaces as a *slot leg* wall outranking the merge one.

Also widened `FAILED_MERGE_OUTCOMES` (`src/queueFlow.ts`) to cover
`merge-walled`: that line's own doc ties the count to what
`TickVerdict.mergeFailures` records, and a walled span records one.
