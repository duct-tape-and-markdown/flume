# The single read now descends, and readAll pays for it per record

Shipped: `PriorAttemptStore.read` probes through `existsLoudUnder`
(`src/fsProbe.ts`) rooted at the `flumeDir` the store was constructed with,
so its silent arm is the same proven absence `readAll` makes. The composed
probe already existed and fit exactly — `dirname` of a record path is always
the keyspace dir, since `slugify` folds any separator out of the stem — so
the fix was the probe swap, not a new walk.

Observed, debt: `readAll` descends the state root and `prior-attempts/`, then
proves each keyspace dir, and then calls `read` per record — which re-walks
all three rungs for every file. Three redundant stats per record, on a path a
tick runs once. Not a correctness issue (the rungs are proven twice, never
less), and pricing a per-record cache against a store that holds a handful of
records looks like the complicated solution. Filing it as an observation
rather than an entry; if the store ever grows, the shape to reach for is
`read` taking an already-proven-dir arm, not a second probe spelling.

Also: after this change `src/priorAttempts.ts` no longer imports bare
`existsLoud`. The remaining `existsLoud` callers in `src/` (`git.ts`,
`Baton.ts`, `cliStateDirs.ts`, `setupWorktree.ts`) are rooted somewhere other
than a state root — worth one sweep pass to confirm each of their silent arms
is an absence a single stat may claim, but none looked like this entry's
class on a read of the callsites.
