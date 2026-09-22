# The neighbour risk resolved itself; the declaration itself is unpinned

The entry flagged `docWalk`'s `SuppliedSet` doc (`tests/helpers/docWalk.ts`)
as a neighbour a reader lands on next: a caller passing a literal list has
written the copy that module exists to avoid. No contradiction after all —
the `instances` table is not a `docWalk` caller. `BUILT_INS` supplies
`Object.keys(builtinGates)`, computed; the table is a separate local whose
subject is the gate/factory classification, not the set. Both statements
stand as written, so nothing in the helper needed touching.

Worth plan's attention: this shipped comment-only, no `tests[]`, no
`pins[]`, and that is structural rather than an omission. What the commit
adds is the declaration of a divergence — prose about prose, which
`engineering.md`'s ladder carve-outs keep out of the suite. So the marker
that stops a sweep re-filing this table is held by discipline alone: delete
the comment and every gate stays green. If the shape recurs (a site whose
only defence against re-filing is a declared-divergence paragraph), the
durable form is likely a sweep lens reading for the citation, not a test.
