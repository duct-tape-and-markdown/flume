# The failure record and the reported row are now one object

The three row-construction sites also spelled a second literal beside each
push — the `{gate, message, verdict?, details?, failingFiles?}` failure handed
to `buildGateRevert`. With `failingFiles` on the row, that literal was a strict
subset of the row, so the failure is now the row itself (`ReportedGateResult`),
and `runAfterCommitGates().failure` / `revertAfterCommitFailure(failure)` are
typed as one. A gate-revert record can no longer name a field the verdict row
dropped.

Two doc comments in `src/Phase.ts` enumerated the row's optional fields
(`details`, `verdict`, `skipped`) in prose and would have drifted again with
this field; both now point at `ReportedGateResult` instead of re-listing it.
Any future optional field lands in one builder and one interface.

No builtin gate populates `failingFiles` yet — only `harness/vitestRunner.ts`
via the chain's vitest gate — so the new row field is exercised by chain gates
alone today.
