# Guard armed; the leak did not reproduce this tick

`installStateRootLeakGuard` (tests/helpers/subprocess.ts) is wired through
`vitest.config.ts` setupFiles into both lanes: refuses at `beforeAll` when a
`.flume` already sits above the fixtures, at `afterEach` when one appears,
naming the test.

**The writer is still unnamed.** Three full fast-lane runs plus one integration
run left `/tmp/.flume` absent. Attribution is bounded: vitest runs files in
parallel, so the guard names the test *this worker* was running when the
directory first appeared; the message says so and points at
`--no-file-parallelism`. Next occurrence yields a worker-local suspect, not a
proof.

Lead: `/tmp/.flume` requires `resolveRepoRoot` to return `tmpdir()` itself,
reachable only from cwd `= /tmp` or `= /tmp/.flume` (the basename special case,
src/cliJobResolution.ts:48). No test in the suite uses either as a CLI cwd
today — the writer may be an out-of-suite process (an interactive session, or a
flume run started from `/tmp`) rather than a test. The guard fires on
appearance-during-a-run regardless of who wrote it.
