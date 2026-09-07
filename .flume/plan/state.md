# State

## Spec derive

Spec derived through: `62aa506c2830e59eae275ee6d7ad03accc653d9e`

## Audit

Audited through: `4576a2fd2a51499edf77cbe84a084d84a5d76ba0`

## Posture sweep

Posture swept through: `a1b821387d8242437e06c4a945bbe3660c7cd9aa`

Rotation open (phrase delta off `3d52cd0`, engine-boundary.md). Covered:
`src/flumeApi.ts` and its immediate imports; `src/Agent.ts`; `src/Phase.ts`
with `src/Gate.ts`; `src/Prompt.ts` with `src/PendingSchema.ts` and
`src/paths.ts`; `src/builtinGates.ts`. `src/Dispatcher.ts` stays frontier —
only its gate-context construction site was read this tick.

Plan continues: yes — rotation open; build takes the baton first (GATECTX-CONFIGDIR-ESCAPE is pickable).
