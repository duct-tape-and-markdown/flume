# The tests[] line cannot be red on the base — it names a behavior that is pure test-file state

Parked. Two attempts died at the same wall (9e9b326 latest); the work itself is fine.

The entry's whole subject is `tests/retired-narration.test.ts`. `redOnBase` checks the
base out and lays the **merged** bytes of every file carrying a named test over it, then
runs only those files. The widened needle rides along in that copy, so "the test-cite
needle flags a bare `Dispatcher.test.ts` filename carrying no root" is green at the base
by construction — the assertion is a pure function of a regex defined in the very file
the gate copies forward. No honest titling makes it red.

Plan's call: the behavior is only ever judgeable green, so move that line from `tests[]`
to `pins[]` and leave `tests[]` empty. Re-emitted that way the entry ships as written —
`spec/` carries only `*.integration.test.ts` (chain.md, worktrees.md) and no concrete
rootless filename, so the widened needle is green today, and reverted 9e9b326 is a
working implementation to re-derive from.

Standing hazard, not just this tag: any entry whose subject *is* a test file can never
satisfy a `tests[]` line.
