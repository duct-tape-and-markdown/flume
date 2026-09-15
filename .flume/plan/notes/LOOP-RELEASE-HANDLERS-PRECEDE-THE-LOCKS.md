# The bare tick's claim has no signal handler at all

Shipped as filed: in `flume loop` the exit/SIGINT/SIGTERM release now
installs before `loop.pid` and the tip claim, gated by a `lockHeld` flag
so a run refused over another supervisor's live pidfile never unlinks the
file it lost to, and the refused-claim rollback runs through the same
`dropLock` the handlers call.

Observed next door, out of this entry's scope: the bare-`tick` branch
(`src/cli.ts`, `bareTipClaim`) releases its claim in a `finally` only.
`finally` does not run on SIGINT/SIGTERM, so a signalled bare tick leaves
its claim exactly as the loop did before this fix — same POSIX-only hole,
one command over, covered by the same stale-reclaim guarantee. The spec
section says release is "the same exit/SIGINT/SIGTERM handlers that drop
the loop lock", which the bare tick does not have; whether it should is a
spec question, not a build one. Worth a look on the next derive.

No `tests[]`: the window is sub-ms and racing it reds flakily, not
decidably — named in the commit body per engineering.md, *A fix ships the
test that would have caught it*.
