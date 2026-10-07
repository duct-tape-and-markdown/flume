# laneTests[] now resolves against declaration.ci, and the hint had to carry the lane names

Shipped as filed: `laneTestsSchema(declaration.ci)` refuses any `lane` the
declaration does not carry, the no-`ci` declaration included. Handed in at
both compositions, not just `gates.ts` — `chain.ts`'s extension is what
`pendingLedger` and `flume check` parse through, so a gate stricter than the
ledger read would have been two rules for one field.

Two things plan should know:

1. **The hint now announces the declared lanes** (`ciLaneClause`). It had to:
   only `plan-inbox`'s prompt carries `declaration.ci` (`inboxWindow.ts`,
   `CI_LANES`), so a derive or sweep tick filing a `laneTests[]` line had no
   rendered source for the valid names and would have learned them only from
   a gate refusal that reverts the whole tick. If a slice ever needs more of
   a lane than its name, the surface to widen is the window, not the hint.

2. **`entryExtension`'s second parameter is now `ExtensionContext`**
   (`{ lanes?, ci? }`), not `readonly Lane[]`. Exported from
   `harness/index.ts`. A downstream chain calling it positionally with lanes
   breaks at tsc — pre-1.0 clean slate, no shim.

Debt, not filed: `judgeGate.ts` narrows `entry.laneTests` through the
shape-only `LaneTestsSchema`, which is now weaker than the field the queue
parsed with. Deliberate — it reads back a value the gate already validated,
and it holds no declaration — but if a reader ever narrows a value that did
*not* come through the gate, that is the hole.

Cost restated from the entry, now mechanical: a consumer whose second host is
a human at a keyboard can file no `laneTests[]` line. That is the mechanism —
nothing could ever have closed one — but it is the first refusal the package
raises over a field a consumer left undeclared.
