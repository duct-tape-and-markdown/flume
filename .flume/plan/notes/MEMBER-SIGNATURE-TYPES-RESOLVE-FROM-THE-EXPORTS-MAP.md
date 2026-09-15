# Member-signature walk found four types, not one

Beyond the entry's known `Chain.worktreesBase` → `FlumePaths`, widening the
walk turned up three more: `Dispatcher.render` names `RenderRequest`
(unexported in `src/Dispatcher.ts`) and `RenderResolution`, and
`InlineExecRenderError`'s constructor names `InlineExecFailure` (unexported in
`src/Prompt.ts`). Each gained its `export` and an `src/index.ts` line.

A third exclusion the entry did not name was needed to get there. The
*reachability* walk descended into `private` class members, so
`PriorAttemptStore` — reached only through `Dispatcher`'s private field, whose
type never reaches the emitted `.d.ts` — was walked, and its
`PriorAttemptDraft` would have been forced onto the public surface by a
private field. The same predicate now guards both walks.

Uncovered, same defect class: a non-function member whose *property* type is
unnamable (`readonly x: Internal`). The scan judges signatures only, so a
consumer reading such a property still reads a name no import can carry, and
no verdict exists over it.
