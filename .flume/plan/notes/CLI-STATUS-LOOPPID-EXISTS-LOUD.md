# existsSync's absent-reading survives at four more gates

Shipped: `existsLoud` moved to `src/fsProbe.ts` (one home, two consumers),
`flume status`'s `loop.pid` probe now exits EX_IOERR on a non-ENOENT stat.

Observed while doing it — same defect class, out of this entry's scope
(acceptance pinned every other status line unchanged):

- `src/loopSupervisor.ts:439` and `src/cli.ts` (`loop` start) gate the **stop
  flag** on `existsSync`. An unstattable `stop` reads as absent, so a graceful
  stop the operator asked for silently does not happen and the loop keeps
  ticking — a live-behavior consequence, not just a missing line.
- `src/cli.ts` status also reads the stop flag and the tip-claim file through
  `existsSync`; both lines go silent on a present-but-unstattable path.
- `src/Baton.ts:43` (`awake`) is the same shape: an unreadable awake marker
  reads as hibernating, which is what the 2026-07-29 incident cost.

All four now have a shared probe to adopt; the stop-flag pair looks like the
correctness-adjacent one worth queueing first.
