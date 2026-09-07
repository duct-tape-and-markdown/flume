# State

## Spec derive

Spec derived through: `3d52cd0888783494afd5b0c18200de9be8796028`

## Audit

Audited through: `19633bf59257aa17e287feaf42fd849665b224f1`

## Posture sweep

Posture swept through: `a1b821387d8242437e06c4a945bbe3660c7cd9aa`

Rotation open (phrase delta off `3d52cd0`, engine-boundary.md). Covered:
`src/flumeApi.ts` and its immediate imports; `src/Agent.ts`; `src/Phase.ts`
with `src/Gate.ts`. `src/Prompt.ts` and `src/PendingSchema.ts` — Phase.ts's
other two imports — were lens-grepped only, not read, so they stay frontier.

Plan continues: no
