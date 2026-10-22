# Both hook-context tables walk; the header cut is now load-bearing twice

Shipped as two reader cases beside the phase-declaration walks in
`tests/examples.test.ts`; no row work, both tables already rowed all four
fields their interfaces declare, in declaration order.

Two things the next tick should know.

Unlike §1's pair, these two tables sit in different sections (§12, §14) and
carry the *same* header cells, `Field` / `What it carries` — the same header
§1's tick-context table carries. `rowNamesOf` cuts by header within a
section, so the cut is sound only because each section opens exactly one such
table. A future section gaining a second `Field` / `What it carries` table
throws there ("the section opens 2 tables headed ..."), which is the right
failure, but it is a page edit red, not a code red — worth knowing before
someone reads it as a helper defect.

The unpinned claim beside these tables is still unpinned, as the entry
predicted: §1 says "a field whose role opens with *Optional* may be omitted",
and `EntryRefusalContext.priorAttempt` / several `Phase` fields are optional
in the declaration while the table states optionality in prose only. Pinning
it needs `docWalk` to report per-member optionality, which nothing else wants
yet. Filing that as its own entry would be a widening of the walk's result
shape for one consumer — my read is it stays parked until a second consumer
asks.
