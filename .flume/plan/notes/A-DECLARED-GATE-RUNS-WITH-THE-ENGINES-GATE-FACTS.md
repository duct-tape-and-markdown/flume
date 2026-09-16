# Gate facts shipped; the entry's blocker was already stale

The entry's "blocked on the engine field the afterMerge variable reads" was
stale: `GateContext.landedOnSha` already ships. Nothing in `src/` changed.

Tests landed in `tests/harnessChain.test.ts`, not the predicted
`tests/harnessGates.test.ts`. That file already owns the declared shell and
script gate cases and the `gateContext` helper they drive, and it reaches the
real writer through `harnessChain` -> `constructGate`; `harnessGates.test.ts`
is the discipline set's file and drives no declared command gate.

Four spellings were build's to declare: `FLUME_COMMIT_SHA`,
`FLUME_STATE_ROOT`, `FLUME_STATE_ROOT_REL`, `FLUME_TOUCHED_PATHS`. They are
documented for consumers in `docs/CHAIN-AUTHORING.md` as well as at the site,
since `spec/harness.md` names only the two sha vars.

One limit, declared at the site: an environment value cannot carry a NUL, so
`FLUME_TOUCHED_PATHS` is newline-joined and a tracked path containing a
newline is unrepresentable there. The engine's own list stays NUL-decoded.
