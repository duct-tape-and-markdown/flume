# The base run's refusal reads the report, and the fixture that could exercise it already existed

Shipped as the entry's `interface` states: `runAtBase` hands its report, its
file filters and the declared `scope` to one refusal at the reader
(`refuseUnaskedFiles`, `harness/vitestRunner.ts`), `run` carries none because
it filters by nothing. The `scope` field's doc now states the refusal instead
of arguing none is possible.

Two things plan may want to know.

**The match relation.** A reported file is accounted for when it *contains*
one of the filters, which is vitest's own positional-filter semantics and a
superset of equality — so the collected set is always a subset of the
accounted set and the refusal has no false-positive arm. It needs no flag
table, only the two lists, which is what made the argv-side alternative
avoidable.

**The case rides the base-red fixture, not the argv ones.** The entry
predicted the case beside the scope cases in the first `describe`, whose
fixture commits exactly one test file — a positional widening there has
nothing to pull in, and adding a sibling would have changed the suite three
green cases read their counts off. The second fixture already commits
`tests/cite.test.ts`, which no judged line ever names, so the case went
there. It is also the sharper demonstration: that file is red at the base, so
the verdict the refusal replaces was a `base-red` ruling over a file the span
never touched.

One untested sentence, by construction rather than by omission: the message's
tail covers the empty-scope reading (a consumer's vitest config collecting a
file no filter named) in the same string, no branch — so there is no arm to
red and nothing to pin. A real instance of it would be a vitest config
forcing an include past a positional filter, which no fixture here has a
reason to build.

Full suite green (2580 passed); the new case reds on the pre-fix runner,
verified by reverting `harness/vitestRunner.ts` alone.
