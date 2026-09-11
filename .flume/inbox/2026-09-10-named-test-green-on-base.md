# A named behavior is proven by a test that also passes on the base (human)

The vitest gate (`.flume/chain.ts` `vitestOnCode` → `.flume/vitestJudge.ts`)
judges a `tests[]` line by finding a passing test titled with it. It never
asks whether that test fails at `ctx.baseSha`. A build that titles an
already-green test with the line passes having proven nothing — the false
green `engineering.md` *A fix ships the test that would have caught it*
exists to close. The gate has `baseSha` and `entry`; it lacks a way to run
the named tests at the base (a throwaway worktree with dependencies). Chain
concern or missing engine surface is the routing question. Correctness-
adjacent: the acceptance gate is the review now.
