# `spec/chain.md` still lists `entry` without `steps`

The field shipped on `GateContext` and `GateBatchSpan`, travelling with
`entry` (absent on a singleton, `[]` on an undecomposed entry), and
`docs/CHAIN-AUTHORING.md` carries its bullet. `spec/chain.md`, *What a gate
receives* does not: its `entry` bullet and its `batch` bullet (which
enumerates a span's fields) both predate this. A build tick cannot touch
`spec/`, so the corpus and `src/` now disagree by one field — the human's
edit, two sentences, next to the `entry` bullet.

Two judgement calls made in the open, both declared at their sites rather
than decided silently:

1. `steps` is optional and absent on a singleton, not required-and-empty,
   because the entry's acceptance says the singleton context carries
   neither. The pair-or-neither invariant is therefore prose plus two
   `...(x ? {...} : {})` spreads, not a type. A union
   (`{entry; steps} | {entry?: undefined; steps?: undefined}`) would hold
   it mechanically, and was declined: `Partial<GateContext>` appears in
   seven test helpers, and `Partial<A | B>` breaks every one. If plan wants
   the invariant a rung up, it is its own entry with those helpers in
   `files`.
2. `declaredFilesGate` (`examples/cascade-chain.ts`) keys one map by path
   across the entry and its steps, so a path two of a session's entries
   both declare is judged under the last. Nothing forbids that duplicate —
   `partition.ts` checks disjointness across *candidates*, never within one
   session — so a queue could produce it. Left as the queue's own defect,
   not the gate's to report; a cross-entry duplicate check inside one
   session may be worth an entry against `PendingSchema`.
