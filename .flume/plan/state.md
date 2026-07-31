# State

## Posture sweep

Posture swept through: `2874c2c` (rotation open — a phrase delta armed the
whole domain).

Covered this rotation: `src/Baton.ts`, `src/Prompt.ts`, `src/builtinGates.ts`,
`src/Agent.ts`, `tests/Agent.test.ts`, `src/Dispatcher.ts`, `src/Phase.ts`,
`src/git.ts`, `src/partition.ts`, `src/job.ts`, `src/PendingSchema.ts`,
`src/cli.ts`, `bin/flume.js`, `bin/flume`, `src/index.ts`, `src/Gate.ts`,
`src/setupWorktree.ts`, `tests/examples.integration.test.ts`,
`examples/backlog-groomer-chain.ts`, `examples/cascade-chain.ts`,
`examples/minimal-chain.ts`, `tests/Gate.test.ts`, `tests/git.test.ts`,
`tests/builtinGates.test.ts`, `tests/PendingSchema.test.ts`,
`tests/job.test.ts`, `tests/Prompt.test.ts`, `tests/cli.test.ts`,
`tests/Baton.test.ts`, `tests/setupWorktree.test.ts`, `tests/Dispatcher.test.ts`.

## Operator leg (not an entry)

v0.10 §6: `.flume/PROTOCOL.md`'s ASCII-only inline-exec section is retired by a
`chore(flume):` commit once INLINE-EXEC-STDIN-TRANSPORT ships. No phase can
write that path — this line is the only durable trigger.

RELEASE-v0.11.md (`1e517d9`) held out of derivation this tick (inbox ruling,
2026-07-31): v0.11 ships after v0.10, and the spec-delta window will not
re-surface this file once this commit lands. Derive it the first tick neither
INLINE-EXEC-STDIN-TRANSPORT nor INLINE-EXEC-RENDER-REFUSES remains in
`<pending-now>`.

Plan continues: yes — sweep frontier still open (`tests/job.integration.test.ts`,
`tests/loop-process-boundary.integration.test.ts`, `tests/partition.test.ts`).
