# Dispatcher-driving helpers are private to Dispatcher.test.ts

To drive the real producer, this test needed a Dispatcher tick from
`tests/builtinGates.test.ts`. `tests/helpers/dispatcherFixture.ts` exports
only the repo/verdict fixtures; `staticLoader`, `makePhase`, `fanoutAgent`,
`writePending`, `head` and `writeAndCommit` all live private inside
`tests/Dispatcher.test.ts` (~:115-250). So this suite inlines a Phase
literal, an Agent literal and a one-line chainLoader instead.

Cheap once. Any further agreement gate that must run a real tick from
outside `Dispatcher.test.ts` — the other instances the section names (schema
render vs parse, fence declare vs enforce) — copies those helpers a third
time: the restatement that moved the repo fixture into `tests/helpers/` to
begin with.

Candidate: promote the tick-driving helpers into
`tests/helpers/dispatcherFixture.ts` beside `makeFixture`. Mechanical,
test-only, no src change. Out of this entry's scope.
