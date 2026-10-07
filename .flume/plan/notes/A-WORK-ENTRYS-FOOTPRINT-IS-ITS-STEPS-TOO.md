# The footprint reads a listing; a gate cannot

`declaredPaths`/`touchedPaths` (`src/PendingSchema.ts`) now take the listing
first, entry second, folding `descendantsOf` — the walk the group's retirement
already shares. Listing-first because a footprint is a property of an entry
*in* a listing; required, so every caller is a typecheck failure rather than a
silent narrowing. The listing is any listing holding the descendants: the queue
(`selectBatch`, `queueFenceViolations`) or the `steps` a slot resolved
(`entryWriteScope`). Tightening that to "the queue" needs a decision — the
write-guard path has no queue in hand.

Three things for plan:

- **`GateContext` carries no steps.** `declaredFilesGate`
  (`examples/cascade-chain.ts`) keys `ctx.entry.files` by new/edit/retire and
  judges only paths the entry itself declared, so a span that touched only a
  step's files reads as touching none of its declaration and hits that gate's
  refusal. The engine holds the set (`ShipContext.steps`); a gate cannot see
  it. Likely a surface entry: `GateContext.steps`.
- **`RenderOptions.assignedSteps` pairs with `assignedEntry` in prose only**
  (`src/Prompt.ts`). Rendered without it, the block states a fence narrower
  than the guard enforces. Both production sites take one slot value so they
  agree today, but the pairing belongs a rung up (`engineering.md`,
  *Narration is the ladder's bottom rung*) — a `RenderOptions` union, or a
  render refusal. I took neither: the union fights the spread-built literals
  in `src/tickAttempt.ts`, and the refusal is behavior nothing asked for.
- **`queueFenceViolations` names a step's offending path twice** — on the
  step's row and on the dispatched entry's. Deliberate and cited at the site.

Breaking at the chain surface: `api.touchedPaths`, `PartitionOptions`
(required `listing`), `isDisjointFrom`, `nextDisjointPick`, `entryWriteScope`.
A 0.22 migration note owes all five.
