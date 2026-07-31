# State

## Posture sweep

Posture swept through: `2874c2c` (rotation open — a phrase delta armed the
whole domain).

Covered this rotation: `src/Baton.ts`, `src/Prompt.ts`, `src/builtinGates.ts`,
`src/Agent.ts`, `tests/Agent.test.ts`, `src/Dispatcher.ts`, `src/Phase.ts`,
`src/git.ts`, `src/partition.ts`, `src/job.ts`, `src/PendingSchema.ts`,
`src/cli.ts`, `bin/flume.js`, `src/index.ts`, `src/Gate.ts`,
`src/setupWorktree.ts`.

`src/` is now fully covered. `tests/Gate.test.ts` was read only in the slice
carrying this tick's finding — deliberately *not* recorded covered.

## Operator leg (not an entry)

v0.10 §6: `.flume/PROTOCOL.md`'s ASCII-only inline-exec section is retired by a
`chore(flume):` commit once INLINE-EXEC-STDIN-TRANSPORT ships. No phase can
write that path — this line is the only durable trigger.

Plan continues: yes — sweep frontier still open (`tests/`, `examples/`, `bin/flume`).
