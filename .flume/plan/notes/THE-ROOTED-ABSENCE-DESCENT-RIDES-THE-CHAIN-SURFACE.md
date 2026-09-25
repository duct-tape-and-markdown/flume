# The engine spells its own rungs at two sites the chain no longer has to

Shipped as filed: `isDirectoryOrAbsentUnder` now rides `FlumeApi` and
`src/index.ts` beside the variadic form, and the cascade example's inbox probe
hands over its root and its dir. `docs/CHAIN-AUTHORING.md` gained a bolded
lead in the path-rule series teaching the rooted form as the default and the
list form as the fan-only shape.

Observed while verifying, not touched: two engine-internal callers spell the
same one-rung descent the example just stopped spelling —
`src/priorAttempts.ts:444` (`isDirectoryOrAbsent(STORE_SUBJECT, this.flumeDir,
root)`, root being `prior-attempts/` under the state root) and
`src/mergingMarkers.ts:84` (`merging/` under the same). Both are correct today
at one segment, and both are the shape that goes wrong the first time the
store is seated deeper — which is the argument the entry made against the
chain-side copy. `src/priorAttempts.ts:447`'s second call is the legitimate
fan (a keyspace dir under a root already proven) and should stay as it is.

Filing this as an observation rather than building it: the swap is
behavior-free, so by `engineering.md`, *A module is one job* it is debt unless
it recurs or bites, and it sits outside this entry's acceptance. If plan wants
it, it is two lines plus the doc sentences at `src/priorAttempts.ts:433` and
`src/mergingMarkers.ts:76` that cite the composed descent.

Also worth knowing: no example under `examples/` now demonstrates the variadic
form at all, so the fan shape's only live readers are engine-internal. The
`FlumeApi` doc for `isDirectoryOrAbsent` names that shape explicitly for that
reason — an export whose consumer is the engine's own walk is fine, but if a
later rotation reads it as unearned surface, that doc line is the answer.
