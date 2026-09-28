# Do `[flume]` log lines carry the instant they were written, and whose decision is it?

From the field (0.19, item 11, priority 30). The verdict now times each gate run
and merge, but the supervisor's and the tick's own log lines carry no time, so an
operator reading a long wave's log cannot tell when a merge landed or how long a
lock wait lasted without opening the verdict. This repo's operator measured a
host sleep only by correlating rendered-prompt mtimes.

Verified this tick: every narration line is `[flume] …` through the `Logger`
seam (`src/log.ts`), ~50 call sites across `src/cli.ts`, `src/Dispatcher.ts`,
`src/waveMerge.ts` and siblings. No spec section states the shape of those
lines — `spec/cli.md` rules `flume status`'s output and nothing else's — so
there is no cite an entry could carry, which is why this is here.

**Where it would live** is the real fork, and it is a boundary call:

1. **`consoleLogger` stamps.** One change, every surface covered — and every
   embedder inherits it. A consumer routing `Logger` to a structured logger gets
   a time in the message *and* in its own field. `engine-boundary.md`, *Surface,
   not prescription* reads this as a default encoding taste.
2. **The CLI wraps `consoleLogger` with its own stamping logger.** `src/cli.ts`
   passes no `log:` today, so this is where the operator-facing decision
   actually belongs; embedders keep clean lines and stamp their own way. Costs
   one wrapper and nothing else.
3. **A chain-declared logger.** No `Chain` field declares one today. Real
   capability, but it answers a question nobody has asked: the operator running
   `flume loop` wants a timestamp, not a seam.

I'd take (2) with an ISO-8601 instant — the idiom every other flume artifact
already uses (the verdict's `at`, the claim file, record filenames) — prefixed
ahead of `[flume]`, on every line the CLI's dispatcher and supervisor write.

What I will not choose for you: the format. ISO instant (`2026-09-28T16:15:03.114Z`,
greppable, wide), wall-clock only (`16:15:03`, readable, ambiguous across a
midnight run), or elapsed-since-run-start (`+04:12`, answers "how long was that
lock wait" directly, useless for correlating with any other artifact). If the
answer is "elapsed", say whether the instant goes on the first line so the run
is still locatable in time.
