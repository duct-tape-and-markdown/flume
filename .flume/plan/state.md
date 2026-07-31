# State

## Posture sweep

Posture swept through: `6328078c54297e395a92bd2e466730017a808e34`

Rotation open (armed by the four `build:` commits since the stamp, touching
`src/PendingSchema.ts` and 8 test modules). Covered this window:
`src/PendingSchema.ts`, `tests/PendingSchema.test.ts`, `tests/helpers/subprocess.ts`,
`tests/Gate.test.ts`, `tests/git.test.ts`, `tests/loop-process-boundary.integration.test.ts`.

## Operator leg (not an entry)

v0.10 §6: INLINE-EXEC-STDIN-TRANSPORT shipped (`f2c7fff`) — the retiring
trigger for `.flume/PROTOCOL.md`'s "Inline-exec commands are ASCII-only"
section has fired. No phase can write that path; a human/`chore(flume):`
commit deletes that section now.

Plan continues: no
