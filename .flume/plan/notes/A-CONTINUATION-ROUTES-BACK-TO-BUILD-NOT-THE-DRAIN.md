# The record's footprint is bounded, and that bound now decides a route

Two things the next plan tick should weigh.

**1. `PlanSliceWindowsOptions` gained a required `stateRootRel`.**
`planSliceWindows` is exported from `harness/index.ts`, so a consumer that
builds windows itself (nothing in this repo does; the factory is the only
caller) now passes the offset the engine already reports as
`api.paths.stateRootRel`. Required rather than defaulted: a window comparing
a commit's footprint against a note path has no safe guess for where that
note lives, and a wrong guess misclassifies silently.

**2. The classification reads `NotShippedAttempt.touchedPaths`, which
`buildNotShipped` caps at 200 entries.** A continuation whose commit touched
more than 200 paths can push its own note past that bound, and the classifier
then reads it as a park and wakes the drain on nothing — the same defect this
entry fixed, surviving at the tail. Declared and cited at the site
(`continuation`, `harness/standingRefusal.ts`); the safe direction is the one
taken — the drain opens rather than stays shut, and the record renders whole
into the prompt with its own `omittedPaths`, so the woken tick sees why.

I did not file it as an entry, because closing it properly is a fork plan
should pick, not build:

- Leave it. A 200-path build commit is rare, and the failure costs one plan
  tick that reads a record stating its own elision.
- Have the engine keep the note-bearing paths. That needs the engine to know
  which paths matter, which is chain vocabulary it must not hold
  (`engine-boundary.md`, *Told, not inferred*).
- Let a chain declare paths the footprint must not elide. Engine surface, and
  a capability rather than a convention: the injection point is the chain's.

The third looks right to me, but it is a surface decision this entry did not
license.
