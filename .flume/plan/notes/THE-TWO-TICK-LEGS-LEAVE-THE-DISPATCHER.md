# The split forced three files the entry did not name

Shipped: `src/singletonTick.ts` (499), `src/waveTick.ts` (1246); Dispatcher
3031 -> 1244. Three unnamed moves were forced:

- `src/tickLeg.ts` — `PhaseTickOutcome` + `TickLegContext`. Without its own
  file one leg imports the vocabulary from its sibling.
- `src/tipVerify.ts` — `liveForeignClaimPid`, `checkMergedTipUnmoved`. Both
  legs take the second; only the wave takes the first.
- `PendingParseFailure` -> `src/PendingSchema.ts`, beside `parsePending`.
  `WaveLedgerParseFailure` extends it and belongs with the wave, so leaving
  the base in Dispatcher.ts makes an ESM cycle that throws at extends-eval.

Also: `consultShouldRun` -> `src/tickAttempt.ts`, beside the refusal record
it writes.

Left open, worth an entry: the pending-ledger I/O family has no file.
`readPending` / `readPendingTolerant` / `isPendingRelocated` stayed Dispatcher
methods (a `tests/Dispatcher.test.ts` case reaches the last as a private);
the rewrite `commitPendingUpdate` is now in `src/waveTick.ts`. One job, two
homes — `engineering.md` *A module is one job*, "a job the tree gives no file
to".
