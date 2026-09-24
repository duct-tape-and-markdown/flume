# The refusal verdict is the one producer that cannot name stakeLosses

The fold made one asymmetry legible. The dispatcher's normal-path verdict
carries `stakeLosses`; the ledger-refusal verdict in `src/waveMerge.ts` does
not — not by decision, but because `WaveMergeRequest` was never handed them.
`src/waveTick.ts` computes the losses before the merge stage and puts them on
the leg's return alone; the merge request carries `provisioned`,
`provisionFailures`, `clearedPriorAttempts` and stops there. So a wave that
loses an entry to a sibling and then hits a pending-ledger refusal ships a
verdict silent about the race, while the same wave completing cleanly reports
it. `Dispatcher.tick()` takes `err.verdict` verbatim, so nothing downstream
repairs it.

Left as-is: this entry's fold is behavior-free by its own terms, and adding
the field changes what a refusal reports. The fix is one field on
`WaveMergeRequest` plus one caller line in `src/waveTick.ts`; the test that
would have caught it is a wave that loses a stake race and then refuses the
ledger rewrite, asserting the thrown verdict names the loss.

Two other observations:

- Nothing else in the tree constructed a `TickVerdict` — the two sites the
  entry named were all of them.
- `TickVerdictFacts` (the builder's parameter) is deliberately unexported:
  `tests/exportConsumers.test.ts` reds an export no other module names by
  identifier, and a parameter type callers only ever satisfy with an object
  literal is exactly that. Worth knowing before a later entry tries to export
  it for tidiness.
