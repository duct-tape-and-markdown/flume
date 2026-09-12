# State

## Spec derive

Spec derived through: `1d424480461e9036c9dfee98fcd5d87be34bf300`

## Posture sweep

Posture swept through: `a1b821387d8242437e06c4a945bbe3660c7cd9aa`

Rotation open (phrase delta off `3d52cd0`, engine-boundary.md; retired-claim
delta closed). Covered: `src/flumeApi.ts` and its immediate imports;
`src/Agent.ts`; `src/Phase.ts` with `src/Gate.ts`; `src/Prompt.ts` with
`src/PendingSchema.ts` and `src/paths.ts`; `src/builtinGates.ts`; `src/cli.ts`
with `src/job.ts` and `src/Baton.ts`; `src/Dispatcher.ts` with its immediate
imports; `examples/`'s three chain modules with `src/index.ts`; `src/cli.ts`'s
remaining helper imports — `src/cliHelp.ts`, `src/cliJobResolution.ts`,
`src/cliJobVerbs.ts`, `src/cliVerdict.ts` — with `src/standardSchema.ts`;
`src/cliChainLoad.ts` with its two consumers; `bin/`'s two scripts with
`tests/bin.test.ts`; `tests/helpers/`'s three modules with
`tests/subprocessHelper.test.ts`; `tests/loopSupervisor.test.ts` with
`src/loopSupervisor.ts`; `tests/chain.test.ts` with `.flume/chain.ts` and
`.flume/vitestJudge.ts`; `tests/PendingSchema.test.ts` with
`src/PendingSchema.ts` and `src/standardSchema.ts`; `tests/examples.test.ts`
with `examples/`'s three chain modules and `tests/helpers/dispatcherFixture.ts`;
`tests/partition.test.ts` with `src/partition.ts` and `src/PendingSchema.ts`;
`tests/builtinGates.test.ts` with `src/builtinGates.ts` and `src/Gate.ts`;
`tests/git.test.ts` with `src/git.ts`.
Frontier remaining: `tests/`'s suite files, less `bin.test.ts`,
`subprocessHelper.test.ts`, `loopSupervisor.test.ts`, `chain.test.ts`,
`PendingSchema.test.ts`, `examples.test.ts`, `partition.test.ts`,
`builtinGates.test.ts` and `git.test.ts`.
