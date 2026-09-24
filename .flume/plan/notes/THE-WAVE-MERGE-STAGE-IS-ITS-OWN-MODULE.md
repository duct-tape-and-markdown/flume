# The merge stage split cleanly; the verdict-assembly job inside it did not move

Shipped as named: `src/waveMerge.ts` holds `runWaveMerge`, the ship lock
acquire/release is that function's signature, and `src/waveTick.ts` (1296 ->
531 lines) is provisioning, fanout, teardown and the handoff fold.

Two things the next derive should know.

**One restatement disappeared, not by design.** `waveNoCommitCause` was called
twice in `runFanout` — once inside the ledger-refusal catch, once after
worktree cleanup — over three inputs, one of which (`revertRefused`) existed
only to feed it. Both calls are now inside the stage and the result rides
`WaveMergeResult.noCommit`, so the wave leg no longer holds the fold's inputs
at all. That was a latent instance of *Derived state is computed, never
restated beside its source*; it closed as a side effect of the split rather
than being filed.

**`src/waveMerge.ts` is 922 lines and I read a second job in it.** The stage's
job is "carry each span onto trunk". The `commitPendingUpdate` catch inside it
assembles a whole `TickVerdict` by hand — ~30 lines of field-spreading that
duplicate, field for field, what `Dispatcher.tick()` builds on the normal path.
That is verdict shaping, not merging, and the duplication is the shape
*A second copy of a sequence* names: two legs spelling the same steps, differing
only in how they return. I did not move it — the entry said behavior-free, and
folding the two verdict builders together is a behavior question (which fields
a partial verdict may omit). Candidate entry, `per` *A module is one job*.

**Citations re-homed** across 11 `src/` modules and `tests/cliVerdict.test.ts`.
`pendingLedger.ts`'s decide-read cite stays at `waveTick.ts` — that read did
not move. No test names either module directly; the split is carried by the
default lane's Dispatcher tests, tsc, and the export/citation pins.
