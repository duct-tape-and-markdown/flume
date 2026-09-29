# How does a drain tell a flake from a real regression in a `gate-revert`?

Two records converged on one gap this tick, and the second is a field instance
of the first.

## The gap

`harness/judge.ts` now ends the `suite-failed` message at its evidence — "the
same N file(s) ran green at `<short>`" — rather than concluding the failure
arrived with the span (`THE-JUDGES-BASE-RUN-REPORTS-WHAT-IT-RAN-NOT-A-CAUSE`).
That was the right removal: one green base run does not make the span the
cause, because a load-sensitive case is red on the merged tree and green at the
base whichever span was merging.

Which leaves the reading to whoever drains the record, with nothing to read it
from. The build note that shipped the removal said so outright: the
discrimination has to come from somewhere other than the judge's prose, and it
is a chain-policy question rather than an engine one.

## The instance, this tick

The standing `gate-revert` for `THE-VERB-PAGES-NAME-THE-STATE-ROOT-WRITE-REFUSAL`
(afterMerge, gate `named lines`, 7be3408d):

    FAIL tests/Dispatcher.test.ts × Dispatcher fanout — the merge-stage crash
    marker ... : AssertionError: expected [ { tag: 'MARK-A', ... } ] to deeply
    equal [ { tag: 'MARK-A', ... } ]

The span touched `docs/CLI.md`, `src/cliHelp.ts`, `tests/cliHelp.test.ts` and
its own note. The failing case is a three-agent fanout ordering case whose own
comment says the order is held on events "never on a sleep, which under the
gate's own load is a coin flip" — so it was written against exactly this
hazard and still went red on a tree that could not have affected it. The
entry's whole span was reverted for it, and the entry is being re-carried now.

I did not file an entry against that case. A fix scoped to a symptom I cannot
reproduce is a guess (`.claude/rules/engineering.md`, *A fix ships the test
that would have caught it*), and the assertion's printed diff is truncated —
I do not know which field differed, let alone why.

## The fork

Where should the discrimination live?

1. **A chain-side re-run.** The declaration gets a policy knob: on an
   `afterMerge` suite red, re-run the failing files on the merged tree once
   before reverting. A real regression reds twice; a load-sensitive case
   usually does not. Costs one extra suite run per red, and only per red.
   The engine already reports `failingFiles`, so the knob has its input.
2. **A chain-side predicate over facts the record already carries.** The
   record holds `failingFiles` and the attempt's footprint; a chain could read
   "failing file outside the span's footprint" as suspect. Cheap, and no extra
   run — but it is inferring a cause from side effects, and a real regression
   can perfectly well red a distant test. I do not recommend it.
3. **The suite declares its own load-sensitive cases.** The knowledge lives
   with the case, not with the drain: a case that holds concurrent agents on
   events names itself, and the gate reports it in a class of its own. Most
   honest, most work, and it needs a convention nothing enforces yet.
4. **Nothing — the drain reads it by hand.** What happened here. It cost this
   tick a paragraph and cost the entry a whole agent span.

My lean is 1: it is a policy knob on a surface that already exists, it
discriminates rather than infers, and it prices only the reds. But the
alternative I would want ruled alongside is whether that `Dispatcher` case
should be reduced to a repro first — if it is genuinely racy, 1 hides a real
defect behind a retry.

## The mechanism, added at the next drain

The entry re-carried and shipped (1615b10f), and its note supplies the load
account this file said it lacked — not a reproduced firing, but enough to name
the suspect mechanically.

The failing case holds MARK-C's agent on `waitFor("MARK-B's merge marker", ...)`
(`tests/Dispatcher.test.ts:7092`) — a wait on a sibling entry's whole
serialized merge, not on a spawned process. Nominal cost of the case is 654ms
measured this tick. The reverted attempt's own seam `beforeAll` added ~9s of 20
CLI spawns to the same lane, two of them starting further node+tsx children,
against `maxWorkers: 4`. The case declares `testTimeout: SPAWN_BUDGET_MS`
(`:188`), so the 10s `waitFor` ceiling fires first and throws *inside the agent
body*, which surfaces as an entry that did not commit — the three-entry
`committed`/`noCommit` deep-equal the record reports. That is consistent, and
nothing cliHelp renders reaches that assertion.

Two facts came out of re-verifying it, and they change the fork above.

**One is now queued, not asked.** `WAIT_TIMEOUT_MS`'s whole sizing warrant is
"well inside the 30s per-case budget the lane's spawning sites declare"
(`tests/helpers/waitFor.ts:29`). No 30s budget exists: the sites declare
`SPAWN_BUDGET_MS` = 120_000 (`tests/helpers/subprocess.ts:131`), documented as
the default lane's own, and sized because "a gate timeout there reverts an
innocent entry". So the ceiling refuses at 10s while its host case has 120s of
budget left — 110s of declared headroom converted into a thrown wait, by a
stale restatement rather than a decision anyone made. Filed as
THE-WAIT-CEILING-IS-SIZED-AGAINST-THE-BUDGET-ITS-CALLERS-DECLARE, `per`
*Derived state is computed, never restated beside its source*; it needs no
repro, because the defect is the restatement.

**The other is still a fork, and it is narrower than the one above.** The
helper promises that "a blown wait reds with its own message rather than
degrading into a bare `expect(false).toBe(true)` at the assertion downstream"
(`.claude/rules/engineering.md`, *Loud or nothing*, cited at the site). For a
hold inside a fanout agent body that promise is false — the dispatcher absorbs
the throw into "did not commit", which is precisely the confident wrong answer
the citation disclaims, and precisely where this revert happened. Either the
helper's refusal has to reach past an agent body, or the sites where it cannot
are declared and cited as the bounded exception that rule asks for.

**How this bears on the fork above.** If the ceiling was simply mis-sized by a
stale copy, then option 1 — a chain-side re-run on every `afterMerge` red —
would have been paying one extra suite per red to absorb a defect with a
mechanical fix. I would rule the queued entry first and re-measure before
ratifying 1: a ceiling sized against the budget its callers actually declare
may leave nothing for the re-run to discriminate. If reverts continue after
it, 1 stands on its own merits and my lean above is unchanged.

## Not part of this question

Whether the marker case is racy at all. That needs a repro, and nobody has
one; it is accepted debt until it recurs with a readable diff.
