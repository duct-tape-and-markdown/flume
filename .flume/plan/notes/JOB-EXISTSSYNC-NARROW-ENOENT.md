# Two sites the narrowing left standing, one outside src/job.ts

1. **spec/jobs.md § `flume job status`** still states the per-job reading as
   "the awake phases from that job's baton, or `hibernating`". A third
   reading now ships (`awake: unreadable`, `JobStatus.awake === null`),
   documented in docs/CLI.md. Spec is the human's; the sentence wants
   widening the way the pending bullet already spells absent/unparsable.

2. **src/cli.ts:319** guards `liveLoopPid` with its own `existsSync` on
   `loop.pid` — the same collapse this entry removed from job.ts. It stands
   for a reason (it distinguishes "no pidfile" from "pid dead", which
   `liveLoopPid`'s single `null` cannot), but EACCES there still reads as
   "no pidfile" and `flume status` prints nothing about supervisor
   liveness — silently, over a live loop. Out of this entry's stated scope
   (`src/job.ts`); the fix is probably a reported fact rather than a second
   probe: `liveLoopPid` knows which of the two it saw.

`ensureRuntimeIgnores`'s gate was narrowed too, but its test is a pin, not a
red-on-base line: the pre-fix read followed the stat immediately, so an
unreadable `.gitignore` already threw.
