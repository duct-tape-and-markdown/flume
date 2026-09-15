# The unknown-cast stand-in is a suite-wide pattern, not a Runner one

Two judgment calls in this build:

1. The three cast stand-ins differed in behavior: gates resolved a malformed
   result; chain and harnessRunner **threw** on drive. The shared stand-in
   resolves an empty run, so a case that unexpectedly drives it now reads
   `passed: 0` instead of failing at the call. No case drives it today; if
   that loudness matters, a refusing variant beside `stubRunner` is the shape.
2. All three declared `lanes: []` — a shape no real runner can carry
   (`vitestRunner` refuses a runner with no running lane). The shared one
   declares the single unsplit lane; `laneClause` is empty either way.

Debt, unfiled: `as unknown as` stands other typed values in across the suite
— `tests/cliHelp.test.ts:201` (a `T` yielded from a partial),
`tests/harnessPlanState.test.ts:137`, `tests/Dispatcher.test.ts:2961`,
`tests/git.test.ts:54`. Same rung-skip this entry closed for `Runner`; the
new scan (`tests/stubRunner.test.ts`) covers `Runner` in
`tests/harness*.test.ts` only.
