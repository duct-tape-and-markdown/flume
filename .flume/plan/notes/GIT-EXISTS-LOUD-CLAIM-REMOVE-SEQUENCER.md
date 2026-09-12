# src/git.ts is clear of existsSync; ~13 existence gates remain in src/

Shipped as written; `git.ts` no longer imports `existsSync` at all. One extra
test rides along: `acquireTipClaim` refuses an unstattable claim rather than
reclaiming the tip — its EEXIST branch reaches `liveTipClaimPid`, so that is
the same probe's higher-stakes half. It also fails on the pre-fix tree.

The lens has a frontier left. Gates still reading every stat failure as
absence, highest stakes first:

- `src/Baton.ts:43` (`isAwake`) — an unstattable awake flag reads as asleep,
  so the loop hibernates over a phase that is awake. Decides dispatch.
- `src/Dispatcher.ts:3937`, `:3979` (pendingPath) — an unstattable queue
  reads as empty: nothing pickable, quiet hibernation. Also `:655`, `:675`,
  `:710` (verdict reads), `:1021`.
- `src/worktrees.ts:178`, `src/priorAttempts.ts:208`,
  `src/cliJobResolution.ts:52` (the `.flume` ancestor walk — an unstattable
  `.flume` walks past the right root), `src/cli.ts:287`,
  `src/setupWorktree.ts:63`/`:64` (lockfile detection; lowest stakes).

Suggested grouping: Baton + Dispatcher queue as one entry, the rest as a
second.
