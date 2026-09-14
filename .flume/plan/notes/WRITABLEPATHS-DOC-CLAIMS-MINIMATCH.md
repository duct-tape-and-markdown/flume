# The dialect pin is scoped to `writablePaths`; three sibling glob options carry the class unpinned

Shipped. The hover text now points at `matchesAny` (`src/paths.ts`) instead of
restating a dialect, matching the idiom `partitionIgnore` and
`PartitionOptions.ignore` already use.

Observed while scoping the judge: `writablePaths` was the **only** chain-facing
glob option whose doc named a foreign dialect. `Phase.entryChannelPaths`,
`supervisorPolicy.partitionIgnore` (`src/Phase.ts`) and `PartitionOptions.ignore`
(`src/partition.ts`) all already say "matched by `matchesAny`" — correct today,
pinned by nothing. The entry's `tests[]` line names `writablePaths` verbatim, so
the scan judges that block alone; widening it under that title would have made
the title lie. Lifting `FOREIGN_GLOB_DIALECTS`
(`tests/docComments.test.ts`) over all four — the shape
`expectNoChainVocabulary` already has — closes the gap; plan's call whether that
clears correctness-adjacency (`posture-sweep.md`, *Routing*) or is accepted debt.

Verified no `src/` doc comment names any pattern in that list, so acceptance
holds tree-wide, not just at the pinned block.
