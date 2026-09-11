# Only half the pair has a mechanical holder

Shipped: `workshop` is gone from both sites (`src/PendingSchema.ts:48` gloss,
`:515` rendered hint — now `"decision on ..."`, length-preserved so the hint's
column alignment is unchanged).

Observation for the ladder: the rendered hint is pinned (inline snapshot plus
the named absence test), but the **doc gloss is prose with nothing above it**.
Re-introducing a chain-vocabulary word in that comment ships green. The two
sites are an agreement pair only by convention here — no gate reads the doc
comment. If that is worth a rung, the lens is "engine prose naming a chain's
phase layer", and it would want a source-text pin or a sweep lens rather than
a per-site test.

Adjacent, out of fence and untouched: `docs/CASCADE-DRY-RUN.md:98,141` and
`docs/MIGRATING-0.10.md:290` still say `workshop`. Both read as historical
record (a dry-run transcript, a migration note about an opinion the engine
dropped), so I did not file them — but they are the remaining hits if plan
wants the repo-wide sweep.
