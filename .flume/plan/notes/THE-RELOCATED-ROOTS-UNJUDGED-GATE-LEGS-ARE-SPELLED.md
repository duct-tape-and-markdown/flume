# Both relocated-root arms now state their unjudged half

Shipped as the entry's `interface` named it: `new blocker resolves` returns
`skipped` under a relocated state root (it judged no edge at all), and
`goal rank` returns `verdict: "placement-only"` (it judged placement and not
provenance). The rejected alternative held up on the tree — placement really
does rule there, and the new case proves it by refusing a misplaced rank
under the relocated root, so `skipped` would have been false.

Two things for the next tick.

**These are `harness/gates.ts`'s only two `dirRel === undefined` arms** —
grepped; no third gate returns green over a leg a relocated root hid. The
records and slice-state arms branch on `ctx.stateRootRel` instead and were
already spelled, so the family is closed.

**`tests/harnessGates.test.ts` now drives the relocated-root *disk* leg of
`readGatedQueue` for the first time.** The two standing relocated cases
(records, slice-state) only need the offset to come back absent; these two
need a real on-disk queue under a root outside the repo, because that leg
reads the disk at both ends of the span. So the file gained a second temp
root (`elsewhere`, cleaned in `afterEach`), a `writeQueueOutside` helper, and
an `at` spelling on `ctxFor`'s `stateRoot` for an absolute root. Nothing
else in the suite reaches that code path; if a future entry touches
`readQueueOnDisk`'s descent or the `null` fold, these are the two cases that
will red.

No question parked, no judgment call deferred.
