# The jobStatus arm needed a symlink hop; the citation scan skips tests/

**The consumer arm could not deny the job dir itself.** `jobStatus` filters
`jobs/` dirents by `isDirectory()`, so a plain file standing in for the job
dir drops the row instead of reporting it unreadable. The only fixture that
keeps the row enumerated while the baton lookup still crosses a non-directory
is a symlink: `<jobdir>/awake -> store/awake` with `store` denied. Shipped
that way, host-guarded (win32 answers the lookup ENOENT). A future entry
naming "the job dir is obstructed" hits the same wall.

**Off-entry.** `.claude/rules/engineering.md` (*Narration is the ladder's
bottom rung*) says the citation carve-out covers a reference in a `src/`,
`harness/`, **or `tests/`** comment, but the pin's repo scan runs
`trees: ["src/", "harness/"]` (tests/commentCitations.test.ts). Every `tests/`
citation — the ones this tick edited in tests/helpers/denial.ts included — is
resolved by nothing. Either the scan is a tree short or the page over-states.

**Left standing:** the cross-host descent stays in `PriorAttemptStore.readAll`;
MERGING-MARKERS-PROVE-ABSENCE-FROM-THE-PATH moves it here.
