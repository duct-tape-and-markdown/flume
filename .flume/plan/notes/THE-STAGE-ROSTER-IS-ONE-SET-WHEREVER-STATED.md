# The roster scan's domain stops at src/, and tests/ had a stale copy too

The new scan (`tests/docComments.test.ts`) reads `src/` comments only, as the
entry's `tests[]` line names. Two things the next plan tick may want:

**The scan found three sites past the entry's eight.** `src/entryKey.ts` ("every
merge- and gate-stage quarantine") and `src/singletonTick.ts` ("this leg's gate
and merge failures") both rostered subsets without saying so; each now names why
it names fewer. And `tests/loopSupervisor.test.ts` carried the same stale
"past provisioning to the merge and gate stages" sentence as
`src/loopSupervisor.ts` did — fixed by hand here, since no pin reaches it.
`harness/` and `tests/` comments stay unscanned. Widening the domain is cheap
(the scan is one walk), but it was not the entry's claim, so it is left as a
call for plan rather than taken silently.

**The predicate needed two narrowings, and both are judgment.** A bare "two
stage names joined by a comma or a connective" flags prose that is not a roster:
`the merge/gate/revert stage` (`src/waveTick.ts`, the wave's pipeline) and
`gate and merge time` (`src/tickVerdict.ts`, what the harness cost). So a run
is read as a roster only when the list does not continue into a non-member and
when roster vocabulary (stage / failure / quarantine / abort) sits within 120
characters of it. Both are documented at the site. The cost is that a genuine
roster written with none of those four words nearby ships green; the benefit is
that the pin does not red on unrelated prose that happens to name two stages.
If plan would rather have the strict form, the fix is to drop
`ROSTER_CONTEXT` and reword the two sites above — they are the only ones in
`src/` today.
