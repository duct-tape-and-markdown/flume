# State

## Posture sweep

Posture swept through: `9894f64ae1cb85eb8f7e59b9e07ef81eed395dde`

Covered this rotation: src/builtinGates.ts, src/Dispatcher.ts, src/Prompt.ts, tests/PendingSchema.test.ts, tests/Dispatcher.test.ts, tests/Prompt.test.ts

## Operator leg (not an entry)

v0.10 §6: INLINE-EXEC-STDIN-TRANSPORT shipped (`f2c7fff`) — the retiring
trigger for `.flume/PROTOCOL.md`'s "Inline-exec commands are ASCII-only"
section has fired. No phase can write that path; a human/`chore(flume):`
commit deletes that section now.

Plan continues: yes — posture sweep rotation open (tests/examples.integration.test.ts is the last unswept frontier module)
