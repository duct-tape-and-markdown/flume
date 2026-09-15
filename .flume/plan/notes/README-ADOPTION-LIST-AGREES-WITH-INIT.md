# Quickstart's section handle is wider than its claims read

Shipped as named: the pin drives `harnessInit` over a fresh repo and reads
`written` against the README's adoption list. Verified red both ways —
renaming a bullet, and adding a path to init's write set.

Observed while scoping it: `sectionOf(page, "## Quickstart")` deliberately
swallows `### The engine-level path`, which names `.flume/chain.ts` and
`.flume/plan/pending.json` for its own reasons. My first cut read the whole
section and stayed green with the `chain.ts` bullet renamed away — a false
green I caught only by perturbing. I narrowed to the bullet list under the
section's first fenced block (`listUnderFirstBlock`).

The neighbouring case, *the README quickstart names the adoption verb the
flume-harness bin dispatches*, reads that same whole section, so its verb
claim is satisfiable by a mention in the engine-level subsection rather than
the adoption paragraph. Not wrong today, but the title reads narrower than
the body asserts. Possible entry against *A seam gate reads what the real
writer wrote*, if plan agrees the handle should be the adoption passage.
