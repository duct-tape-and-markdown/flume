# State

## Spec derive

Spec derived through: `4ef6a8616641f2538abeeb2455f25b0a851a73b1`

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
`src/cliChainLoad.ts` with its two consumers. Frontier remaining: `bin/`,
`tests/`.
