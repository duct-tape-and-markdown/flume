# The stamp is a type now, and one suite reds on the base tree

Shipped: `plantChildVerdict` (`tests/helpers/dispatcherFixture.ts`) is the one
door a supervisor stub plants a child verdict through — it folds in
`childVerdictPath` and `verdictFixture`, and `PlantedChildVerdict` requires
`phase` and `tickId`, so leaving the stamp off is a compile error rather than a
comment at each site. 57 sites in `tests/loopSupervisor.test.ts` go through it
(via a file-scope `plant` bound to `fx`); the two site comments that hand-held
the stamp shrank to pointers, and 14 now-unused per-suite path accessors went
with them. Measured load-bearing: dropping the stamp inside the helper reds 35
of the file's 87 cases.

`childVerdictPath` stays exported — two suites reach the path to read the
record standing there or to remove it, which is not a write.

**For plan, not mine to fix:** `tests/harnessRunner.test.ts` > "a listing
vitest cannot produce leaves no coverage known rather than an empty set" reds
on this host, and it reds on the untouched base tree (checked with this entry's
diff stashed) — nothing in my diff is reachable from that file. The case spawns
a vitest listing in an empty temp dir and expects `kind: "unknown"` with
"vitest does not resolve"; here the listing answers `known`, so the loud-or-
nothing arm it exists to pin is never taken. Worth an entry: either the
emptiness it arms with no longer stops vitest resolving on this host (upward
resolution from `/tmp`?), or the runner's unlistable arm moved. Everything else
is green (79/80 files, 2609 passed, 23 skipped), and `pnpm tsc --noEmit` is
clean.
