# The widen made the exclusion list answer for itself

The widen turned up 131 dangling citations, not nine: 101 bare rule-page
basenames, 5 broken wraps, ~25 stale or external names.

The hole worth a ruling: a string literal is a resolution arm, and `tests/`
is now judged, so `EXTERNAL_VOCABULARY` resolved every name it excused — all
ten pre-existing entries included. The override had gone decorative and
nothing said so. Closed structurally by moving the list to
`tests/helpers/external-vocabulary.json`, which no module imports and so no
program holds, plus a set-level pin that it still overrides something.

Per entry the pin cannot go: a `dist/` cite dangles in a fresh checkout and
resolves once anything has built.

Residual: `tests/` literals added ~5700 tokens to the resolver (4829 ->
10522), so a symbol deleted from `src/` still resolves if any test spells it
in a string. Narrowing the literal arm to `src/`+`harness/` was tried and
costs ~39 fixture citations (mostly `tests/exportConsumers.test.ts`), each
then excused by name — worse.

Also: a `describe`/`it` title is a string, not a comment, so ~15 titles
citing a bare rule page stay unjudged.
