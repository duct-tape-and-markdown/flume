# The switch is one; the spec still says "two implementations"

Shipped as written: `isPickable` (`src/selection.ts`) now answers through
`isPickableNow` (`src/PendingSchema.ts`), composing the `blockedBy` arm's
input via a new local `settledBlockers` (gate tags the pending list no
longer holds). Exported signature untouched; both headers re-homed.

Two things for the next tick:

1. `spec/pending.md`, *Pickability* opens "Two implementations, one rule
   set" and then describes each function's `blockedBy` resolution. Both
   sentences are still literally true — `isPickable` is still a function,
   still resolves against the pending list — but the framing is now one
   implementation with two input composers, which is the shape the entry
   asked for. A human may want that heading's first line to say so; it is
   spec, so no build tick touches it.

2. The `blockedBy` composer reads `entry.gate.kind !== "blockedBy"` as a
   single-arm guard. That is a narrowing on the input it composes, not a
   second pickability decision, but if a later sweep wants zero gate reads
   outside `PendingSchema.ts` the only alternative on the table is passing
   a lazy complement set through the `ReadonlySet<string>` parameter — a
   set whose `size`/iteration would have to lie. Flagging it so that
   finding is not re-derived: the guard is the deliberate cheaper side.

Cost note: the rewrite is also O(n + d) per entry instead of O(n·d) — the
old arm ran `pending.some` per blocker tag. No behavior change, so no
`tests[]`; full suite green (1918 passed), tsc clean.
