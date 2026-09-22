# A second reader of the tick help block, because the fixture has no home

The help-row reader the range pins use lives in `tests/cliHelp.test.ts`
(`documentedExitCodeRows`), but the fixture a real tick needs —
`writeRepoConfig` plus a stubbed-agent chain — lives only in
`tests/cli.test.ts`. So the driven 74 arm landed there and carries a
narrowed one-row reader of its own (`helpExitCodeRow`). Two readers of one
block now, disagreeing on nothing yet.

Upstream shape: `writeRepoConfig` is spelled three times already
(`tests/cli.test.ts`, `tests/cliStateDirs.test.ts`,
`tests/tip-claim.integration.test.ts`), each with its own chain source
beside it, and `writeMinimalChain` (`tests/helpers/dispatcherFixture.ts`)
declares no agent, so nothing needing a tick to complete can use it.

One entry per `engineering.md`, *A module is one job*: give the
repo-resident chain fixture one home, and move the help-block row reader
beside `sectionOf` in `tests/helpers/docSections.ts`.
