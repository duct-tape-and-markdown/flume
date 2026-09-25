# Two facts the per-pick ledger moved that the entry did not name

**The merge marker had to move with it.** `spec/loop.md`, *Crash equals stop*
ties the marker's retirement to the ship bookkeeping: once the queue no longer
carries the picked entry, the hazard is closed. With the rewrite per-pick, a
wave-end `clearMergingMarkers` would have left a shipped, already-retired
entry's marker standing across the rest of the wave — a crash there makes the
next `loop` start refuse over a hazard that no longer exists, a false-refusal
class the old ordering did not have. So each pick retires its own marker
inside its own hold, and the marker set on disk is now exactly one pick wide.
Two pins in `tests/Dispatcher.test.ts` moved with that: the crash-marker case
now reads B's marker from B's own pick window (B reaches no gate), and
`landedOnSha` now lands on the sibling's ledger commit rather than the
sibling's span.

**`TickResult.commitSha` is now the last of N, not the wave's one.**
`WaveMerge.chorSha` keeps the most recent ledger commit a wave landed. A wave
of five shipped entries makes five `chore(flume): ship` commits and the
handoff sees the fifth. Nothing in-tree reads it as "the wave's whole ship",
but `Phase.ts`'s "SHA of the produced commit" now under-reports a fanout wave,
and a chain wanting all of them has no surface. Possible entry.

**The mid-wave refusal verdict is a snapshot.** `ledgerRefusal`
(`src/waveMerge.ts`) builds from the wave facts as they stand when the rewrite
refuses. `mergeAttempt` is skipped for every sibling after that, but agents
still running can still push `renderFailures`, so the verdict can name fewer
render refusals than the settled wave had. Before this change the rewrite ran
after every agent had finished, so the verdict was always complete. Cheap to
close (rebuild the verdict at the `throw mergeError` in `src/waveTick.ts`);
left alone because the throw's own contract is that the wave is walled.
