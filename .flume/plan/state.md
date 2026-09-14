# State

## Spec derive

Spec derived through: `07b550ce0606597aadaf14c84d18648410d23509`

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
`tests/git.test.ts` with `src/git.ts`; `tests/Prompt.test.ts` with
`src/Prompt.ts` and `src/builtinGates.ts`; `tests/Agent.test.ts` with
`src/Agent.ts`; `tests/paths.test.ts` with `src/paths.ts` and `src/job.ts`;
`tests/Gate.test.ts` with `src/builtinGates.ts` and `src/Gate.ts`;
`tests/priorAttempts.test.ts` with `src/priorAttempts.ts`;
`tests/worktrees.test.ts` with `src/worktrees.ts`, `src/paths.ts` and
`tests/helpers/dispatcherFixture.ts`; `tests/cliVerdict.test.ts` with
`src/cliVerdict.ts` and `tests/helpers/subprocess.ts`; `tests/job.test.ts`
with `src/job.ts`, `src/Baton.ts`, `src/paths.ts` and `src/Dispatcher.ts`;
`tests/cliJobResolution.test.ts` with `src/cliJobResolution.ts`, `src/cli.ts`,
`src/Baton.ts` and `tests/helpers/subprocess.ts`;
`tests/setupWorktree.test.ts` with `src/setupWorktree.ts`;
`tests/friction.test.ts` with `src/friction.ts`;
`tests/build-changelog.test.ts` with `scripts/build-changelog.mjs` and
`tests/helpers/subprocess.ts`; `tests/examples.integration.test.ts` with
`src/Agent.ts`, `src/Gate.ts`, `src/Baton.ts`, `src/Dispatcher.ts`,
`src/flumeApi.ts` and `examples/backlog-groomer-chain.ts`;
`tests/loop-process-boundary.integration.test.ts` with `src/Baton.ts`,
`src/Dispatcher.ts` and `tests/helpers/subprocess.ts`;
`tests/tip-claim.integration.test.ts` with `src/Baton.ts` and
`tests/helpers/subprocess.ts`; `tests/cliJobVerbs.test.ts` with
`src/cliJobVerbs.ts` and `tests/helpers/subprocess.ts`; `tests/cli.test.ts`
with `src/cli.ts`, `src/Baton.ts`, `src/Dispatcher.ts`, `src/builtinGates.ts`,
`src/Gate.ts`, `src/job.ts`, `src/paths.ts`, `src/git.ts` and
`tests/helpers/subprocess.ts`; `tests/job.integration.test.ts` with
`tests/helpers/subprocess.ts`.
Frontier remaining: `tests/Baton.test.ts`, `tests/Dispatcher.test.ts`,
`tests/cliHelp.test.ts` and `tests/docComments.test.ts`.
