# docs/CLI.md is the third copy of the tick cause phrases

Shipped: each `tickExitCode` arm carries its cause phrase, and the tick
page's exit-code block renders the arm-owned causes from `tickExitCauses`
(`src/cliVerdict.ts`). Each row still states the causes it owns — the
refusals `main` takes before a `TickOutcome` exists, and the 74 row — which
is where those are decided.

Not reached, and fileable: `docs/CLI.md` § `flume tick` states the same
causes a third time, in its own grammar (one flowing sentence per verb,
"exits `2` on usage — …", the introducing verb `namedExitCodes` keys on).
CLI-DOC-TICK-EXIT-CODES-PINNED pins that section's *range* against the same
driven producer, never its causes, so a cause re-routed between two codes
already in the range still ships green over that page. It cannot splice the
block's clauses verbatim — wrong register — so closing it is a fork: a
second renderer that speaks the page's grammar, or a pin reading the
section's per-code sentences against the labels (the shape
`sentencesNamingExitCode` already takes for the loop 74 row).

Smaller: the tick block now wraps its clauses through `wrapClause`
(`src/cliHelp.ts`), so `BAY_DISCOVERY_LINES`' hand-wrapping is load-bearing
only for the pages that still splice `bayDiscoveryRefusal` into a template.
