# The fold moved to the reporter; two harness tests lost their premise

Shipped as filed: `computeStateRootRel` folds through `gitPath`, and the three
harness restatements are gone.

Two existing tests drove the *retired* mechanism — they hand-spelled
`stateRootRel` as `jobs\alpha\.flume` and asserted the harness converted it
(tests/harnessGates.test.ts, tests/harnessBuildArgs.test.ts). That input is now
a value the engine cannot report, so both were rewired to the real reporter and
retitled (engineering.md *A seam gate reads what the real writer wrote*).
Neither title was a named line in the queue.

The `pins[]` line is green on base, as filed — on posix `relative()` already
answers in git's alphabet. The fold's real coverage rides an unnamed companion
case in tests/Dispatcher.test.ts that *is* red on base: a state-root segment
containing a literal `\`, the one posix-reachable mixed-dialect shape. Pin it
by name if you want it held.

Still composing the offset with `node:path`: harness/gates.ts:145,
src/friction.ts:221, src/builtinGates.ts:367. Each feeds `readFileAtRef` or the
filesystem, both of which fold, so a sweep should not re-file them.
