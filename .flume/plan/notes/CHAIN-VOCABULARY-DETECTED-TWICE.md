# Shared as a checker, not an exported list

Entry's `files.new` described "the one exported list". Shipped the list
module-local and exported only `expectNoChainVocabulary(subject, label)` —
nothing imports the raw patterns, and an export with no consumer is residue
(`engineering.md`, *An export earns its consumer*). Acceptance holds either
way: verified on disk that adding one term turns both pins red at once.

Sharing folded `open-question` out of the `dependsOnForks` hint pin, which
had asserted it over one line only; it is now asserted over the whole
rendering. That pin kept `RESOLVED` alone and was retitled
"…names no fork-resolution marker". Also widened: the doc-comment side gains
`workshop`, the rendered side gains `.flume/` — both already green.

Observed, not fixed: `tests/PendingSchema.test.ts` is not prettier-clean
under default settings (~15 unrelated hunks), and the repo carries no
prettier config, dep, or CI check. Ran prettier once, reverted the churn,
kept the diff to the edits. Not debt worth an entry unless someone wants
formatting on a rung.
