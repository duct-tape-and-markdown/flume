# Two sibling roster tables on the same page, complete and unpinned

The §1 tables are pinned by row sequence, not coverage: `rowNamesOf`
(`tests/helpers/docSections.ts`) reads the backticked name opening each row's
first cell, cut to one table by that table's header cells because both sit
under one `##`, and the two cases compare the sequence against the checker's
declaration order. A field gained, a row dropped, and a row out of order all
red on one equality.

Measured while here, same class, outside this entry: §12's
`EntryRefusalContext` table and §14's `OrderContext` table each row all four
fields their interfaces declare today, and neither is pinned. (An earlier
attempt on this entry measured §12 missing `declaredAs`; the row has since
landed.) The reader is in place, so arming both is two `rowNamesOf` cases and
no row work — a cheap entry, and the only thing holding those two tables is
that nobody has edited them yet.

Unpinned claim left standing in §1: "A field whose role opens with *Optional*
may be omitted; the rest are required." The walk reds on a missing row, never
on a row whose optionality disagrees with the declaration. Checking it needs
`docWalk` (`tests/helpers/docWalk.ts`) to report each member's optional flag
beside its name — a widening of that helper's result nothing else wants yet,
so a candidate rather than residue.

`LIST_CLOSE` became `BLOCK_BREAK` in `tests/helpers/docSections.ts`: the table
cut wanted the same blank-line predicate, and a third copy of it in one module
was the alternative.

The prior attempt on this entry was reverted at `afterCommit` by the per-cites
gate naming a *different* queue entry's dangling cite
(`SEVEN-STRANDED-WARRANTS-NAME-THE-SHAPE-ON-DISK`, since gone). A build tick
cannot write the queue, so that gate can revert work no tick it reverts is
able to fix — one wasted tick, measured.
