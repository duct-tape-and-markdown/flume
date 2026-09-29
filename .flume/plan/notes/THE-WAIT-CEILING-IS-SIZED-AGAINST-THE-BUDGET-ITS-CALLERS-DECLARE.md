# The ceiling's scans are one module wide, by construction

Shipped: `tests/helpers/waitFor.ts` states no budget figure (it names
`SPAWN_BUDGET_MS` and cites its home), its header opens on either lane, and
`tests/subprocessHelper.test.ts` carries three checks — no figure in the
warrant, the ceiling under the budget (the relation the retired "well inside
the 30s" sentence was asserting in prose), and the header's lead against the
lanes that really import the helper, read off `laneRule` rather than a list.

Two things for the next rotation.

**The scans are keyed to one path.** `WAIT_HELPER` is a constant, so the
lenses — "a doc comment spelling a figure another module owns", "a header
scoping a module to one lane while both call it" — reach nothing else under
`tests/helpers/`. Generalizing wants a vocabulary this tick had no measured
drift for: which comments are warrants for a constant, which figures are
owned elsewhere. `grep 'integration lane.s\|default lane.s' tests/helpers/`
is clean today, so the lane half has no second site; the figure half was
never surveyed. Filing a generic scan on one instance would be the
precision-for-its-own-sake `engineering.md` warns off, so it is left unfiled
rather than built.

**A stale figure survived because no seam could see it.** The two constants
live in sibling modules that do not import each other, so nothing typed or
pinned related them until this entry; `10_000` sat under a warrant naming
`30s` while the real budget was `120_000`. Any other cross-module numeric
relation stated only in prose is the same shape — the sweep's "expired
narration" lens reads scope, not arithmetic, and would not have caught this
one either.
