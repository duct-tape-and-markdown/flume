# liveLoopPid has no src/ caller left, and the lock's win32 pins moved

The loop lock now goes through `stakePidClaim` (`src/pidClaim.ts`), so
`flume loop`'s was the last `src/` call to `liveLoopPid`. The export is
still earned (tests call it, and a fixture chain in `tests/cli.test.ts`
drives it as the runtime's own read), so this is not an
`engineering.md`, *An export earns its consumer* finding — but the pid-only
accessor now exists for the suite alone, beside `liveLoopClaim`, which
`flume status` uses. Worth a look: either one reader with callers dropping
the instant, or `liveLoopPid` declared as the test-facing spelling.

Two consequences plan may want to see:

- The stake `mkdir`s the lock's dirname, so cli.ts's
  `mkdirSync(toNamespacedPath(flumeDir))` at the loop's start went with the
  hand-rolled write — one directory-create, not two.
- `const lockPath` in the loop verb is no longer folded through
  `namespacedJoin`: the verb hands it to the stake, which folds the target
  and the dirname itself. The win32 source-shape pins in `tests/cli.test.ts`
  ("cli.ts — loop.pid win32 MAX_PATH fix") were rewritten for that: one case
  holds that the binding reaches no fs call in cli.ts, and the every-call
  case now classifies each `loopLockPath` use as folded-here or
  staked, with both arms pinned populated. A third guard reaching for the
  lock path and folding neither way still reds.

`renderPidClaim` now has exactly two writers: the stake and
`acquireWaitLock` (`src/waitLock.ts`), whose divergence is declared at the
site.
