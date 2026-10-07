# The blockedBy cycle is refused; the deadlock through containment is not

Shipped: `queueForestErrors` (`src/PendingSchema.ts`) now refuses a queue whose
`blockedBy` edges close a cycle, naming every entry the cycle runs through, in
each member's own file at the `gate.tags.<i>` it declared — the same shape the
`parent` cycle refusal already had.

Two adjacent shapes this read still admits, neither in this entry's acceptance:

1. **Deadlock through containment.** A `work` entry `blockedBy` its own parent
   `group`, or a `group` `blockedBy` one of its descendants, is never pickable
   for exactly the reason a cycle is not: a group leaves the queue with its last
   descendant (`spec/pending.md`, *The queue is a forest*), so each waits on the
   other. No `blockedBy` edge closes, so the cycle walk does not see it. The
   step rule catches the one instance where the waiter is a `step` (its own work
   entry is "not a step"); above `step` nothing does. Same *Loud or nothing*
   finding, one rule further out — the walk would mix the two edge kinds
   (declared blockers and containment), which is a decision, not a mechanical
   extension, so it is left for plan.

2. **A blocker naming no entry in the queue** is admitted, and this entry's
   `pins[]` fixes that as the contract. Worth knowing why it is load-bearing:
   selection reads absence from the queue as shipped (`settledBlockers`,
   `src/selection.ts`) and wave-end prunes shipped tags from the list
   (`spec/pending.md`, *Wave auto-unblock*), so a typo'd blocker is a silently
   open gate that reads as a satisfied dependency. Refusing it would be the
   louder read, but it would also refuse a hand-restored queue whose blockers
   shipped long ago. A question, not an entry.

No live queue entry carries a `blockedBy` gate today, so the new refusal
changes nothing on disk this tick.
