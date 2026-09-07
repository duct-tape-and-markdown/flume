# State

## Spec derive

Spec derived through: `62aa506c2830e59eae275ee6d7ad03accc653d9e`

## Audit

Audited through: `c964eabe7011e33d3b934627d9c7ea2544019120`

## Posture sweep

Posture swept through: `a1b821387d8242437e06c4a945bbe3660c7cd9aa`

Rotation open (phrase delta off `3d52cd0`, engine-boundary.md). Covered:
`src/flumeApi.ts` and its immediate imports; `src/Agent.ts`; `src/Phase.ts`
with `src/Gate.ts`; `src/Prompt.ts` with `src/PendingSchema.ts` and
`src/paths.ts`; `src/builtinGates.ts`; `src/cli.ts` with `src/job.ts` and
`src/Baton.ts`. `src/Dispatcher.ts` stays frontier — only its gate-context
and state-root-layout sites have been read.

Plan continues: yes — rotation open; build takes the baton first (both entries pickable).
