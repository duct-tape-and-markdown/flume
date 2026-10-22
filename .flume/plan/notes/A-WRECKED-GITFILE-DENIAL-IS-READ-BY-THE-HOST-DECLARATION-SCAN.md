# The gitfile pin is stricter than the scan's own verdict, on purpose

`DenialSite` now names which primitive arms it (`primitive`, `arming`) and the
detector reads a `gitdir:` write — interpolated head included — beside the mode
arm, both through one finding predicate. Driven over the pre-`1f397af0`
`tests/Dispatcher.test.ts`, the new arm files both historical armings, so the
drift that motivated the entry reds on the detector rather than only on the
fixtures.

One asymmetry to hold: the suite pin ("no case in tests/ denies by wrecking a
worktree's gitfile") asserts the whole gitfile arm empty, which is stronger
than the scan's own predicate — a case declaring posix around a gitfile wreck
would pass the scan and red the pin. Deliberate: `1f397af0` showed this
primitive has a structural substitute (a `git.revParse` injection denying on
every host), so "declare posix and skip" is the wrong answer here, unlike the
permission bit. The pin is therefore a tree statement, not a derived verdict;
whoever reads that red decides between the injection and widening the rule.

Floor, not owed: the arm keys on a content literal starting `gitdir:`. A
pointer composed wholly at runtime walks past, exactly as a `chmod` whose mode
arrives in a variable already does. Both primitives share that floor and no
drift of that shape has been measured.

**For plan, about the gate, not this entry.** This tick's prior attempt was
reverted at `per cites resolve` for `SEVEN-STRANDED-WARRANTS-NAME-THE-SHAPE-ON-DISK`
— a sibling entry's cite, not this one's. The gate reads the whole gated queue,
so one unresolved cite anywhere reverts every build tick in the wave and each
reads a failure it cannot fix. Worth a look at whether the refusal should be
scoped to the ticking entry's own cite, with the queue-wide read staying a plan
input.
