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

## Not part of this question

Whether the marker case is racy at all. That needs a repro, and nobody has
one; it is accepted debt until it recurs with a readable diff.
