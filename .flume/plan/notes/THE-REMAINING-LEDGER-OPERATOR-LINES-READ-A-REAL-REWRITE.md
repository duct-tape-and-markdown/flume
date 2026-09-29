# The fourth no-commit line combination is still unread

Shipped: the committing line's two arms (`ship commit` / `footprint commit`)
and the `footprints for` subject, all three driven from a real
`commitPendingUpdate` over a real repository. Each was mutation-checked on
this tree: flipping `shippedTags.length > 0` at `src/waveMerge.ts:1096` reds
the ship arm one way and the footprint arm the other, and flipping the
subject test at `:1119` reds the new footprint case.

Observed while doing it: the no-commit line is a product of two independent
halves — 2 subjects (`shipped` / `footprints for`) x 2 exits
(`dock-outside-repo` / `nothing-to-write`) — and three of the four
combinations are now read. The unread one is `footprints for X; pending
already up to date, no commit`: a footprint-only wave whose footprint is a
re-record of paths the entry already carries, so `withObservedFiles` returns
the same entry, nothing is written and the exit is `nothing-to-write`. It is
reachable (the same collision a second time around, which the
`nothing-to-write` comment at `src/pendingLedger.ts:667` names as its
motivating case), and the halves are composed independently, so no arm can
be read into it from the three that are pinned. Not filed as a defect — the
entry's acceptance named three lines and they are green — but it is the
remaining hole in this family if plan wants the set closed.

Also: the describe's docblock said "the two no-commit lines"; it now states
the two-halves shape, since the case count under it is three.
