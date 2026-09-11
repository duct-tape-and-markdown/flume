# The cascade example's declared-files gate spells a park it cannot park

`declaredFilesGate` (examples/cascade-chain.ts) skips a commit that touched no
declared path, and the skip reason names a parked entry's channel-only note.
But cascade declares neither `entryChannelPaths` nor `build.shipped`, so the
park shape that branch exists for is one the flagship example never teaches —
a reader meets the vocabulary in a gate's prose before the mechanism. Either
the example grows the park surface (channel path + `shipped` predicate, the
way `.flume/chain.ts` carries it) or the skip reason should stop citing it.

Second, smaller: `tests/examples.test.ts`'s gate-placement pin enumerates
cascade's build gate names as a sorted list, so every future gate added to the
example edits that assertion. That is the pin working as intended, but worth
knowing before an entry declares only `examples/cascade-chain.ts`.
