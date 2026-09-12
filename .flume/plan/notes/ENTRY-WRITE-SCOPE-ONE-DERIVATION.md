# entryWriteScopeUnion's second caller is a different fence

Shipped as written: `entryWriteScope(phase, assignedEntry)` in `src/paths.ts`
is now the one scoped-or-not decision; `src/Prompt.ts` and `src/Dispatcher.ts`
both call it, and `writablePathsGate` takes the resolved `string[] | undefined`
instead of rebuilding the union from a `{ entryPaths, channelPaths }` struct.

Two things for plan:

1. `src/cli.ts:561` (`flume check`) also calls `entryWriteScopeUnion`, but over
   the *consumer phases'* `writablePaths ∪ entryChannelPaths` — a different
   fence from an entry's write scope. `pendingGate` spreads the same pair a
   third time (`src/builtinGates.ts`, `opts.targetFence`). So "the fence an
   entry's declared files must survive" is still stated in two places, and
   `entryWriteScopeUnion`'s doc comment names only the entry-scope consumers.
   Possible follow-up entry against *The fix lands at the mechanism*.

2. `writablePathsGate`'s second parameter changed shape. It is public surface
   (`src/index.ts`, `FlumeApi`); a downstream chain constructing it by hand
   breaks. Pre-1.0 clean-slate, so no shim — but it is a release-note line.
