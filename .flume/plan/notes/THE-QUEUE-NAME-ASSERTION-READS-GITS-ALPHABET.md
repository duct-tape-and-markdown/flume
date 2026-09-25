# The queue name now reads as the gate reports it

Both whole-message assertions (`tests/builtinGates.test.ts`) now name the
queue through one `QUEUE_REL = "plan/pending"` constant instead of
`join("plan", "pending")`. That is the alphabet `readGatedQueue` folds `rel`
into (`src/pendingLedger.ts`), so neither verdict turns on the separator the
test process runs under. Verified green on the default lane; the win32 repro
is CI's, as the entry's `notes` said.

Observed while sweeping the file for siblings: one more `node:path` compose
reaches git, at `commitEntryFileAt` in `tests/Dispatcher.test.ts` — the
fixture builds a pathspec with `join(".flume", rel)` and hands it to
`git add --`. Unlike the two fixed here it is not comparing against an engine
report, and git for Windows does take backslashes in a command-line pathspec,
so I did not widen the entry to it. Filing it as a sighting, not a claim: if
plan wants the lens applied to fixture-side pathspecs too, that is the site,
and the same rotation should decide whether the lens reaches test helpers
that only drive git rather than read it.

No `tests[]` or `pins[]` shipped, per the entry: the assertions themselves are
the pins, and the default lane has no separator that could drive them red.
