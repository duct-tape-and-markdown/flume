# Supervisor extracted; two spec cites now stale, one new test helper

Shipped. `src/Dispatcher.ts` 5717 → 5229; supervisor body and its 7 suites
moved byte-identical but for repointed cites.

**Out of fence — needs a human spec edit.** `spec/chain.md:348` and `:358`
both cite `src/Dispatcher.ts:superviseLoop`; the symbol now lives in
`src/loopSupervisor.ts`. `spec/cli.md:182` and `spec/loop.md` name
`superviseLoop`/`defaultTickRunner` without a module path and stay correct.
CHANGELOG hits are historical, left alone.

**Widened past `entry.files`, inside the fence.** The moved suites share
`fx`/`silent`/`verdictFixture`/`writeMinimalChain` with the ~14k lines that
stayed. Rather than copy them, they moved to a new
`tests/helpers/dispatcherFixture.ts` (sibling to the existing
`helpers/subprocess.ts` idiom) which both suites import;
`blamedOnFixture` was supervisor-only and moved outright.

`readTickVerdict` gained its export as the entry predicted — sole consumer
is `src/loopSupervisor.ts`, named in its doc. `src/index.ts` untouched.
Two pre-existing `loop()` cites in Dispatcher docstrings named a method
that does not exist; repointed while there.
