# The classifier's fix leaves one `as Error` in `src/`, over an engine-owned thrower

`grep -n 'as Error' src/` now returns two sites, neither in `tickAttempt.ts`:

- `src/claudeCode.ts:300` — the mint widening its own `new Error` to attach
  `code`. Not a read of a caught value; nothing to file.
- `src/pathIdentity.ts:82` — `unresolved: err as Error`, where `err` is
  whatever `realpathSync.native` threw. Same cast shape as the one this entry
  removed, but the thrower is Node, not chain code, so the "an adapter could
  have rejected with anything" argument does not reach it. If plan wants it
  folded anyway, the change is `unresolved?: Error` → the two facts
  `throwFacts` reports; the only consumer interpolates the value into a
  comparison-refusal message, so a non-`Error` would print `undefined` there
  exactly as the classifier did. Not filed by this tick — no measured drift.

`throwFacts` moved to `src/thrown.ts` and `thrownMessage` now computes from it.
Neither is in `src/index.ts`, so both stay internal cross-module surface; no
export pin moved. No comment anywhere named `src/tickVerdict.ts` as
`throwFacts`'s home, so the move stranded no citation — the header claim was
the only one, and it shrank to a pointer as the entry called for.

Standing debt the entry scoped out, unchanged: ~30 inline `err instanceof
Error ? err.message : String(err)` reads across `src/` and `harness/` that
could each be `thrownMessage`. Now that the fold has one home carrying both
readings, that sweep is a mechanical single-entry job rather than a judgment
call.
