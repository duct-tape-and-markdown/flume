# One take, two decisions — and a pin that keyed on `let`

The two verb copies collapsed, but writing `takeCountValue` as its own
find/read/splice sequence would only have moved the duplication into
`src/cliArgs.ts` beside `takeFlagValue`. The shape that actually holds: a
module-private `takeDecidedValue` runs the sequence once, and the two exports
are the two decisions about the word behind the flag (the presence test, and
`parseMaxValue`). Both verbs now read `takeCountValue`, refuse `null` in the
same arm as their positional check — a refused pair is left standing, so one
refusal answers both — and `?? DEFAULT_*` their own default at the site.

One pin moved, worth plan's attention as a class: `tests/docComments.test.ts`
selected the loop verb's default line with `/let max =/` and asserted it names
`DEFAULT_TICK_BUDGET` rather than a literal. The property it pins survived
untouched; the pin red because the initializer became a `const`. A
source-text pin that selects its line by the *declaration keyword* rather than
by what the line states is red-on-refactor with nothing wrong in the tree.
Repointed to `/const max = /`, which is the same defect one keyword along —
the selector wants to key on `max =` and the constant name, and every
`soleLineMatching` caller in that file is worth a read for the same shape
before the next one bites. Not filed: no behavior can change through it, and
it is one site's selector, not a family yet.

Adjacent, unfiled: `--json` in `src/cliHistory.ts` is a third flag reading
(presence-only, one-word splice, no value). One verb spells it, so there is no
family and no home for it in `src/cliArgs.ts` yet; it becomes one the moment a
second verb takes a bare flag.

`pnpm tsc --noEmit` and the full suite green (2181 passed, 22 skipped).
