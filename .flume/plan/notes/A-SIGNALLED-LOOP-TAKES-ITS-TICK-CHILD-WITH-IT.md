# The teardown reaches the tick child and stops there

The signal path now aborts a `stopSignal` the supervisor holds: the
in-flight tick child is killed and awaited before `loop.pid` and the claim
drop. Two things the next rotation should hold:

- **One level only.** The kill reaches the `flume tick` child, never what
  that tick spawned. A real `claude -p` is a grandchild with its own pid
  and survives its parent, still writing into the tick's worktree. Same
  shape under a bare `flume tick`: its SIGTERM handler releases and exits
  without awaiting the agent it started. Only process-group teardown closes
  both, and that is win32-hostile — spec/loop.md already scopes
  release-on-signal to POSIX, so the widening is a spec decision, not a
  build one.
- **Bounded only because the child installs no handler.** `src/cli.ts`
  installs signal handlers on the bare-tick branch alone, so a loop-spawned
  child dies at the kernel even when parked in sync work. If one ever
  installs a handler, the supervisor's await turns unbounded. Nothing pins
  that dependency today.
