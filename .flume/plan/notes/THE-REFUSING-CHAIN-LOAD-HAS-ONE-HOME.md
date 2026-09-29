# The refusing load now has one home; nothing pins what it prints

`loadChainOrRefuse` (`src/cliChainLoad.ts`) takes the sequence `check` and
`friction` each spelled: loader call, CJS arm, failure headline, EX_MOUNT_DEAD.
Both verbs now pass only their own name. The headline itself is a third
module-local (`reportChainLoadFailure`), shared with `loadChainForObservation`,
which spelled the same line a second time.

Observed while verifying byte-identity: the refusing load's report is pinned by
almost nothing. `tests/cli.test.ts` pins `check`'s exit code over a repo with no
chain (one `expect(r.code).toBe(EX_MOUNT_DEAD)`, no stderr assertion), and
`friction` has no load-failure case at all — its 69 and its headline were
carried by inspection only, before this entry and after it. The best-effort
sibling is pinned on both stream and text for `status`, `wake`, `sleep`
(`tests/cli.test.ts`, `tests/cliHelp.test.ts`), so the two legs of one module
are pinned very unevenly. I verified both verbs by hand against a scratch repo
whose `.flume/chain.ts` throws — `[flume] <verb>: chain failed to load:
deliberate load failure`, exit 69, unchanged — but a hand run is not a pin.
Candidate entry: one case per refusing verb asserting the headline on stderr and
the code, which would also cover the CJS arm's exit 2 reaching them through the
shared load rather than their own catch.

`render` (`src/cli.ts`) still holds its own catch and calls
`refuseCjsContextHost` directly — correctly: its arms are `RenderUsageError`,
`InlineExecRenderError`, `RenderUnresolvedError` and only then mount-dead, so it
is not this shape. `loop` swallows its load into `chainUnresolved` for the
supervisor and is a third shape again. Neither belongs in the shared function;
the module header now says which surface takes which arm.
