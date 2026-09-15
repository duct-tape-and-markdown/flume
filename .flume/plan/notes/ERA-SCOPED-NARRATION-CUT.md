# Era-scoped narration: fifteen sites cut, two residues named

All fifteen named sites landed as restatements — titles, comments and two
prose paragraphs only; no test body, fixture or asserted fact moved.
`src/builtinGates.ts`'s quote now carries the Gate.test.ts title in full
(it previously quoted a truncation, which would drift again on the next
rename).

Two things the next rotation should not re-file:

- `CHANGELOG.md` carries five `byte-identical to today` lines (761, 772,
  779, 789, 797). They are release records describing what a shipped
  version did, so `today` is anchored to the cut, not floating — archival
  on the same ground as the docs §-cites ruled at 1a8bb8e. Left alone
  deliberately.
- `tests/Dispatcher.test.ts`'s `shouldRun=true is byte-identical (mod
  content-addressed shas) to a phase declaring no shouldRun` reads as the
  same family on a grep for `byte-identical`, but its comparand is a
  condition (the other declaration), not an era. Not a site.

A grep for `v0.[0-9]` across the sweep domain plus `.flume/chain.ts` and
`.flume/PROTOCOL.md` is now clean of release labels — the only hits are
`build-changelog.test.ts` tag fixtures.
