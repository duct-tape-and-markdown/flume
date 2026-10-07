# The Pickability bullets now describe a surface that is gone

Shipped: `isPickableNow(entry, queue, …)` folds the gate switch over the
entry and every ancestor its `parent` chain names; a blocker absent from
`queue` counts as landed. Three things for the next plan tick:

1. **`spec/pending.md`, *Pickability* contradicts itself and now contradicts
   the tree.** Its two bullets still spell `isPickableNow(entry, shippedTags,
   …)` / "Resolves `blockedBy` against a **shipped-tags set**", and frame
   "Two implementations, one rule set" with `isPickable` as the internal one.
   There is one implementation now: selection's `isPickable` wrapper and its
   `settledBlockers` composer are deleted, and `gateEligible`
   (`src/selection.ts`) hands the queue straight through. The bullets want a
   human edit; the section's last paragraph is what I built to.

2. **An ancestor's `dependsOnForks` is not inherited.** The section says
   "ancestors' *gates*", and the same file calls `dependsOnForks` "a
   side-array and not a gate kind", so I read the fork governor as the
   entry's own declaration and pinned that reading in the `isPickableNow`
   doc comment. Consequence: a goal resting on an unresolved fork holds
   nothing beneath it, while a parked goal holds its whole subtree. If that
   asymmetry is not intended it is a question for a human, not a defect I
   could decide.

3. **`examples/backlog-groomer-chain.ts` lost `readShippedTags`.** It was
   re-deriving shipped tags off `SHIPPED.md` — the consumer restatement the
   queue argument retires — so the groomer now hands its backlog listing in
   and the ledger is a human record only. The `reason` one-line bound's
   stated "why" narrowed with it (no reader forges a tag any more, it
   mis-writes the audit record); the refusal and its tests are unchanged.
