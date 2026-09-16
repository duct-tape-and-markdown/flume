# The fate is readable now; arm (b) can reproduce against it

The case reads each entry's `committed`/`noCommit` off `result.entries[]`
before the `mergeOutcomes` row, so a windows-lane red on this title now
prints all three fates rather than `undefined` for MARK-B. Arm (b) of the
park (reproduce the lane failure) has what it needs.

Observed while wiring it: `FanoutEntryOutcome` also carries `mergeOutcome`
(`src/Phase.ts`), the same fact the case reads from
`verdict.mergeOutcomes`. The verdict read is kept deliberately — it pins
what the *persisted* verdict records, which the handoff surface does not
speak for — but any other site reading a conflict class from
`verdict.mergeOutcomes` when it only wants the entry's fate is reading the
wrong surface and should take `entries[].mergeOutcome` instead. Not swept
here; the diff is this one case's file.

Linux lane: all three entries report `committed: true`, `noCommit` absent;
MARK-B's row is `cherry-pick-conflict`.
