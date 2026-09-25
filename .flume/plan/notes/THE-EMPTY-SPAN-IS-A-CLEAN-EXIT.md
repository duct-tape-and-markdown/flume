# The empty span's arm reads the diff the gate loop wanted anyway

**A spec sentence now reads narrower than its own row.** The `clean-exit`
row folds the empty span in, but the bullet under the table still says "How
the agent process ended is consulted only when the ref did not move". I
followed the row: `classifyNoCommit` consults the termination for the empty
span too, so an agent killed mid-run whose span happens to be empty stays
`platform-preempt`. Letting a platform failure read as the agent's own clean
exit is the harm the taxonomy exists to prevent, and an empty span is no
reason to make the exception. The bullet's own subject is a *usable* commit
being honoured, so I read the two as agreeing — but the sentence says "ref",
not "usable commit", and a human should decide whether it gets reworded.

**`CleanExitAttempt` gained two required fields, `spanBase`/`spanHead`.**
Reading a record is additive — a consumer narrowing on `mode` just sees two
more. Constructing one breaks loudly (a type error; our own fixtures took it
across seven test files). `buildCleanExit` is internal and
`CleanExitAttempt` is not named in `src/index.ts`, so the blast radius is
test fixtures hand-authoring a `PriorAttempt`. The 0.20 line has no
`docs/MIGRATING-0.20.md` yet and this is its first record-shape break — I did
not open one, since starting the next page in the series (its back-link, its
place in the README's index) is a call above this entry.

**`runAfterCommitGates` stopped deriving the span footprint.** The
empty-span read needs exactly the diff the gate loop was computing for
itself, so the caller computes it once and hands it in; the function's
`touchedPaths` return is gone, and the revert path takes the caller's copy.
The identity pin (one array instance across every gate) holds because the
array is passed through, not copied — worth knowing before anyone adds a
second caller that wants to hand in a fresh list per gate.
