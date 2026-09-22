# `flume loop` reads the same lock past the same guard

Shipped: status's two claim reads now sit inside the guards that already
classified their presence probes, and those two messages say "failed to
read" — true of a stat failure and of an open failure alike. The stop
flag, which is only ever stat'd, keeps "failed to stat".

The same class stands one verb over, unfiled: `flume loop` calls
`liveLoopPid` (src/cli.ts:1250) outside any try, so a `loop.pid` that is
present and unreadable throws to `main()`'s catch — raw stack, exit 1.
That is numerically the code `loop` already uses for "another loop (pid N)
already runs; refusing", so an operator reads a lock held by a pid the
message never names. Its sibling probe a hundred lines up — the stop flag
at src/cli.ts:1136 — classifies to EX_IOERR, and spec/loop.md's exit
contract names 74 there. Repro is this entry's: `mkdir <flumeDir>/loop.pid`.
