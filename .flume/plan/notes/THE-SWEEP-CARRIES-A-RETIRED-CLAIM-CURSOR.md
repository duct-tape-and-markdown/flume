# retiredThrough is a cursor no cursor table holds

Shipped as written. Two things the next plan tick should weigh.

**The entry's type probe was backwards.** `AnyCursorField` was *not* widened
by the optional field: `CursorFieldsOf` tests `PlanStateOf<S>[K] extends
string`, and an optional field's lookup is `string | undefined` under
`exactOptionalPropertyTypes`, so it resolves to `never`. `-?` strips
optionality from the mapped result, not from the indexed access. So `CURSORS`
needed no entry and none was added.

Cost: `judgeSliceState` reports no `CursorStep` for `retiredThrough`, so the
slice-state gate names a step for `sweptThrough` alone. Admitting it would
mean `Cursor.in`/`Cursor.at` answering `retiredThrough ?? sweptThrough`. Not
built: nothing reads such a step today, and the may-move rule covers the one
loss no later tick can see. Fileable under *A fact the engine holds is
reported* if a consumer needs it.

**The sweep window reads its own state file twice per render.**
`cursorWindow` reads it for `sweptThrough`; `retiredCursor`
(`harness/sweepWindow.ts`) reads it again for `retiredThrough`. One small
JSON file, inside the same bound, so a malformed artifact still refuses by
name — but it is two decodes of one artifact. Teaching `cursorWindow` about a
second field would put a sweep field on the derive's path, so the fix if it
ever earns one is a render handed its slice's parsed state, not a wider
cursor key. Debt, not correctness.

**Why a stale cursor after a close is harmless:** the delta's *paths* still
come from `unionOf(all, locus)` — the locus paths the range past
`sweptThrough` touched. A closing tick that forgets to move `retiredThrough`
therefore diffs an empty path list, not a wide range. That is load-bearing
for the may-move rule reading only while the stamp stands still.
