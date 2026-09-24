# priority landed; two follow-ons the next derive should weigh

**The default materializes on disk.** `priority: z.int().default(0)` follows
`dependsOnForks`' shape, so the parsed type carries it required and the ship
rewrite writes `"priority": 0` into every entry file it touches. Churn is
harmless today (one array, rewritten wholesale) but becomes a per-file diff
once THE-LEDGER-IS-A-DIRECTORY-ONE-ENTRY-PER-FILE lands: a ship would rewrite
a sibling's file to add a zero it never declared. If that is unwanted the
field wants `.optional()` with the comparator reading `?? 0` — a decision, not
a defect, so it is here rather than in the queue.

**The engine holds the ordering and reports it to nobody.** `byQueueOrder` is
module-private in `src/selection.ts`; `FlumeApi` carries `isPickableNow` but
no sibling for order. A consumer picking out of its own queue therefore has
to re-spell the comparator — `examples/backlog-groomer-chain.ts` picks in
array order and now says out loud that this is its own convention, not the
engine's. If a downstream chain asks for the engine's order, the fix is an
exported comparator beside `isPickableNow`, not a copy in the chain
(`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered*). Not filed: no consumer has asked yet.

**Two fixtures leaned on array position.** `SHIP-CLEAN` (resetKeepTo
collision) and `PICKED` (chain-declared refusal) in `tests/Dispatcher.test.ts`
turn on one entry merging ahead of its sibling; both now declare `priority: 1`
rather than relying on the order they were written in. The directory entry
will rewrite these fixtures again — the priorities are load-bearing, not
decoration.

**Not touched:** `flume status` lists only capability-skipped entries, never
the queue in order, so no ordering surface there needed the field.
