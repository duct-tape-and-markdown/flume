# Two findings from driving loop's three 74 arms

1. The lock arm reports no path. `src/cli.ts` (the `liveLoopPid` guard) says
   "The I/O error carries the offending path itself", so it prints
   `STATE_ROOT_NAMES.loopLock` alone — but node's `EISDIR` from reading a
   directory carries no path, and the operator gets
   `loop.pid failed to read: EISDIR: illegal operation on a directory, read`.
   Its stop-flag and merging-dir siblings both name the resolved path.
   Narration asserting a fact that does not hold, over a refusal naming a
   state-root-relative name under a root that may be relocated.

2. `makeRepo` — mkFixtureRoot + seven git calls — is spelled in six suites
   (cli, cliStateDirs, runtimeIgnores, examples.integration,
   tip-claim.integration, loop-process-boundary.integration). This tick gave it
   a home at `tests/helpers/scratchRepo.ts` for its own use and adopted none of
   the six; the unit-lane copies (cli.test.ts:986, cliStateDirs.test.ts:418)
   are identical to it modulo the prefix, so adoption is mechanical.

Scope stands as the entry states it: tick/status/log cause lists are the same
hole, and this tick's readers reach them unchanged.
