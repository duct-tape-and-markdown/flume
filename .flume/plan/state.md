# State

## Posture sweep

Posture swept through: `89258d671bb1f8bed072601ac632acf3024f8bb2`

Rotation armed (code delta touched src/Prompt.ts, src/builtinGates.ts,
examples/cascade-chain.ts, tests/examples.integration.test.ts,
tests/PendingSchema.test.ts, tests/Prompt.test.ts past the stamp). Covered
this rotation: src/Prompt.ts, src/builtinGates.ts.

## Operator leg (not an entry)

v0.10 §6: INLINE-EXEC-STDIN-TRANSPORT shipped (`f2c7fff`) — the retiring
trigger for `.flume/PROTOCOL.md`'s "Inline-exec commands are ASCII-only"
section has fired. No phase can write that path; a human/`chore(flume):`
commit deletes that section now.

RELEASE-v0.11.md (`1e517d9`) held out of derivation (inbox ruling, 2026-07-31):
derive it the first tick neither INLINE-EXEC-STDIN-TRANSPORT nor
INLINE-EXEC-RENDER-REFUSES remains in `<pending-now>`. INLINE-EXEC-RENDER-REFUSES
still pending.

Plan continues: yes — posture sweep rotation open, frontier not empty
