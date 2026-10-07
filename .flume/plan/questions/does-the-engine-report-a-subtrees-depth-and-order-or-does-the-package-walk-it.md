# Does the engine report a subtree's depth and order, or does the package keep its own walk?

`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered* — the fork is which side of the boundary the forest walk sits on.

Observed on disk 2026-10-07. `harness/goals.ts:82`-`:113` builds its own
children map and depth-first `descend` while `descendantsOf`
(`src/PendingSchema.ts:1049`) is exported and taken by `src/queueGoals.ts`,
`src/pendingLedger.ts` and `src/waveTick.ts` — one job, two walks (first noted
75e80bd9, which called retiring the copy behavior-free; it is not). The
package's walk carries two facts the export discards: **depth**, which
`goalsBlock` indents by (`:175`), and a **total sibling order** (`:91`), which
`harness/order.ts:60` leans on so a wave's sequence cannot move with a
directory listing. `descendantsOf`'s own doc states the opposite —
"the order the subtree comes back in carries nothing" (`:1041`).

The goal predicate rides the same fork: `kind === "group" && parent ===
undefined` is spelled at `src/queueGoals.ts:45`, `harness/goals.ts:69` and
`harness/gates.ts:403` — three modules, one engine-owned shape
(`spec/pending.md`, *The queue is a forest*), reported by nothing.

Options:

- **Engine walks, caller orders.** `subtreeOf(entries, tag, compare)` answers
  `{entry, depth}[]`; the sibling order is the caller's comparator, so the
  engine ships mechanism with an injection point and declares no convention
  (`engine-boundary.md`, *Capability vs convention*). `descendantsOf` becomes
  one call of it. Recommended: the only option that removes a walk.
- **Engine declares the order.** `descendantsOf` gains depth and a fixed
  parent-then-tag order. Cheapest diff; every consumer inherits that order.
- **Package keeps its walk, declared and cited.** No engine change; two walks
  stand, and the forest shape has two homes.

The goal predicate wants an engine export either way, or an entry of its own.
