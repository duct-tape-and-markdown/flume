# Seven stranded names re-stated; the `{@link}` pin makes a doc link an import

All seven sites read as the entry described them, and all seven are now
stated off the tree. Three things the next plan tick may want.

**A doc-only `{@link}` is a real import.** `src/priorAttempts.ts` already
carried `import type { InlineExecRenderError }` solely so its
`buildRenderRefused` doc link resolved; naming the other two render
refusals cost two more type-only imports. That is the citation pin working
as designed, but the shape — an import list whose members no code arm
reads — is worth knowing before someone "cleans up unused imports" there.

**`Dispatcher.ts:582` was the model, not a site.** `RenderUnresolvedError`'s
doc already named all three render-refusal sources. The two rosters this
entry fixed (`buildRenderRefused`, `RenderFailure`) were the two that had
not been re-read when stage 1 gained its refusal. A third roster existing
and being correct is why this family reads as drift rather than as a
missing surface: nothing sweeps a roster when a sibling extends the class.

**Not filed: `tests/cli.test.ts:1423`.** Its title says "state-root write
refusal", which scanned as the same stranding as `cli.ts`'s `dispatch` doc.
It is not — that case really does exercise an unwritable awake-flag
directory, so the title is accurate as written and a widening to
"access refusal" would make it less precise. Left alone.

**Line-number drift in the entry.** `tests/Dispatcher.test.ts` was cited at
`:19990`; the teardown-harvest comment is at `:20068`. The describe title
and the quoted phrase both resolved, so the site was unambiguous — noting
only that a 78-line offset in a 20k-line test file is cheap to mis-follow.

Comment-only. `pnpm tsc --noEmit` clean, full suite 2168 passed / 22
skipped, no assertion touched.
