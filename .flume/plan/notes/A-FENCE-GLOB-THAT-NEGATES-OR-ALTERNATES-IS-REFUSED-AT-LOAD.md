# One more chain-declared glob list reads the same dialect

`Chain.supervisorPolicy.partitionIgnore` is the other glob list a chain
declares and `matchesAny` reads (`src/partition.ts`,
`src/pendingLedger.ts`). A leading `!` or a `{a,b}` set there compiles to
a literal exactly as it did in a fence, so the ignore silently ignores
nothing. The symptom is milder — a wider collision set and narrower fanout
waves, not a false green — but it is the same silent degradation this entry
fenced, and the glob the author wrote reads correctly in every dialect but
this one.

I scoped the refusal to `writablePaths` and `entryChannelPaths` because that
is what the cited section names, and widening the engine's refusal past the
spec's words is not build's call. `validateFenceGlobDialect`
(`src/chainLoad.ts`) grows by one field if a human wants it;
`foreignGlobForm` (`src/paths.ts`) is already the shared predicate, so the
dialect would not be spelled twice.

Smaller thing: `foreignGlobForm`'s result type is deliberately unexported.
Callers read its two fields and never name the type, so exporting it reds the
export-earns-its-consumer pin with no consumer to earn it. Cited at the site.
