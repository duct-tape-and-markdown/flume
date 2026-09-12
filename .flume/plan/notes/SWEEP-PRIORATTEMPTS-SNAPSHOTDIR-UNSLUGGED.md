# `TickContext.priorAttempts` is slug-keyed; the phase leg hands out a raw key

Shipped as written: `priorAttemptStem` is now the one `slugify` both
`priorAttemptPath` and `PriorAttemptStore.snapshotDir` derive from.

Observed while fixing it, out of scope, not filed:
`priorAttemptRef` (`src/priorAttempts.ts`) slugifies its entry leg
(`slugify(entry.tag)`) but passes `phase.name` raw. Every *path* is safe now
— the stem slugifies — but `readAll()` keys its map by the on-disk stem, so
for a phase whose name needs slugifying (`plan_sweep`, `Plan Derive`) the map
a chain reads as `TickContext.priorAttempts` is keyed `plan-sweep`, not
`plan_sweep`. A `shouldRun` doing `ctx.priorAttempts.get(phase.name)` reads
"no prior" and the retry loses its predecessor silently — `engineering.md`,
*Loud or nothing*.

Not live here: this chain's phase names are already slug-shaped
(`plan-inbox`, `build`). Two forks if plan wants it: slugify the phase leg in
`priorAttemptRef` so key and stem agree, or have `readAll` key by the raw
value it cannot recover (it can't — so the first).
