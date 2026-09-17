# Neither attempt keyer is on the package's public surface

`recordAttemptKey` ships beside `entryAttemptKey` in `src/priorAttempts.ts`,
unbarrelled as the entry directed. But the exports map has two subpaths, `.`
and `./harness`, so neither keyer is reachable from outside the package: a
downstream chain holding `TickContext.priorAttempts` still has no engine
spelling of the key and would rebuild the join — the same defect this entry
closed one consumer in. `entryAttemptKey`'s own doc already claims such a
reader ("outside the engine, a consumer asking which of the queue's entries a
refusal is still standing against"); that reader cannot import it. Either the
claim is residue or the surface is short a re-export. Plan's call.

Smaller: `renderBuildRecords` still spells `keyedAs` and `key` into its
per-record header (`--- <keyedAs> (<key> keyspace) ---`). Display text, not a
map key, so I left it — but it is the identity in a second shape.
