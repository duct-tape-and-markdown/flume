# The override needed a 13th declaration field

`spec/harness.md` *The default `handoff`* says a consumer overrides "by
declaration", but *What a consumer declares* has no `handoff` row, and names
"two of its fields [as] values with behavior (the runner and the resolver)".
Shipped as `handoff: byPhase(HandoffValue).optional()` — per phase, so
overriding build's routing does not force a copy of the slice ladder. The
spec needs a human edit: a table row, and "three".

Two more for the chain-factory entry:

- `defaultHandoff` refuses a slice set without `plan-inbox` — the refusal leg
  has nowhere to route. A consumer disabling that slice must declare its own
  handoff. The schema does not know that yet; a cross-field refusal at load
  (like `slices.sweep`'s) may be the better home.
- `.flume/chain.ts:624`'s `misdeclaredLine` — a `gate-revert` whose judge
  said a `tests[]` line "already pass on the base" — routes to inbox at
  `shouldRun`, not at `handoff`, so the package default does not carry it.
  The slice `shouldRun` predicates still owe it.
