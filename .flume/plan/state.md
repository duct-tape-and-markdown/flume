# State

## Spec derive

Spec derived through: `eb69567256868e4ed55913f2f4a8276fb9c08f26`

## Posture sweep

Posture swept through: `a1b821387d8242437e06c4a945bbe3660c7cd9aa`

Rotation open (phrase delta off `3d52cd0`, engine-boundary.md; retired-claim
delta closed this tick). Covered: `src/flumeApi.ts` and its immediate imports;
`src/Agent.ts`; `src/Phase.ts` with `src/Gate.ts`; `src/Prompt.ts` with
`src/PendingSchema.ts` and `src/paths.ts`; `src/builtinGates.ts`; `src/cli.ts`
with `src/job.ts` and `src/Baton.ts`; `src/Dispatcher.ts` with its immediate
imports; `examples/`'s three chain modules with `src/index.ts`; `src/cli.ts`'s
remaining helper imports — `src/cliHelp.ts`, `src/cliJobResolution.ts`,
`src/cliJobVerbs.ts`, `src/cliVerdict.ts` — with `src/standardSchema.ts`;
`src/cliChainLoad.ts` with its two consumers; `bin/`'s two scripts with
`tests/bin.test.ts`; `tests/helpers/`'s three modules with
`tests/subprocessHelper.test.ts`. Frontier remaining: `tests/`'s suite
files, less `bin.test.ts` and `subprocessHelper.test.ts`.
