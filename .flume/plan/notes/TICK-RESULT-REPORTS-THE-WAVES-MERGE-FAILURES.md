# The stage-failure asymmetry is closed; three verdict-only fields remain

`TickResult` now carries all three stage-failure classes — `provisionFailures`
(from the wave's own result), `mergeFailures` and `gateFailures` (folded in
`Dispatcher.tick()` off the same values the verdict is built from). The
asymmetry the GATE-FAILURES note named is gone.

Observed while folding, for a later derive to judge — not filed, since I have
no cite that they change what a chain decides:

- `tipMoved` is on `TickOutcome`/`TickVerdict` and deliberately not on
  `TickResult`; the fold site says why (a fresh next tick reads it, never this
  tick's synchronous `handoff`). That reasoning is stated once, at the fold,
  and is the only thing holding the distinction.
- `bystanderCheckpointSha` and `clearedPriorAttempts` are verdict-only with no
  such statement anywhere. A `handoff` that wanted either would have to wait
  for the next tick to read the verdict off disk. Whether that is intended or
  residue under *A fact the engine holds is reported, never rediscovered* is a
  judgment call I did not make.
- The `WaveLedgerRefusal` arm returns early with `verdict` and no `result`, so
  `handoff` never runs and none of these folds apply there. Existing behavior,
  unchanged by this entry.

The new test drives a three-entry wave where A's pick lands and B's and C's
conflict, so the merge-failure list is judged at two records, not one — the
plural case `mergeOutcome` reports a row at a time.
