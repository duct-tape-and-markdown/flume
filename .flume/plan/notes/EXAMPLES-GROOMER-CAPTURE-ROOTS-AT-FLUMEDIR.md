# A tests[] line filed into the integration lane cannot be judged

The entry predicted both behaviors in `tests/examples.integration.test.ts`.
They shipped in `tests/examples.test.ts` instead: the `vitest` gate runs
`pnpm vitest run --reporter=json`, which is the FAST lane
(`vitest.config.ts` excludes `**/*.integration.test.ts` unless
`--mode integration`). A named behavior whose only passing test lives in the
integration lane is invisible to `judgeVitestReport` and to `redOnBase` —
the gate reverts the commit reporting "no passing test".

Worth plan knowing when it predicts `files.edit` for an entry naming
`tests[]`: predicting an `*.integration.test.ts` path is predicting a
revert. The drives here are cheap (280ms for both — git plumbing and the
chain's own deterministic groomer, no spawn), which is exactly the split
`tests/examples.test.ts`'s header already documents.

Candidate promotion (`engineering.md`, *Narration is the ladder's bottom
rung*): the lane rule is prose in two file headers and nothing checks it. A
chain-side check — an entry's `files` naming a test path the gate's lane
excludes — would hold it a rung up.
