# Two harness-lane parks closed in one chore commit

Closes, from an interactive session (`chore(flume): close the harness-lane parks`):

- *Flume's own build has no declared-files gate* — took the recommended floor. `declared span` gate (afterCommit, build) refuses a span meeting none of a non-empty `files`; partial span, empty declaration, and park pass and say so. `isPark` is now the one park shape `shipped` and the gate both read. Pinned in `tests/chain.test.ts`.
- *Flume's own build prompt hand-writes the tests[]/pins[] contract* — `TESTS_HINT`/`PINS_HINT` rendered from the extension hints; `prompts/build.md` keeps only the framing. Agreement pin over the shipped template + both real `promptArgs`.
- *`.flume/chain.ts` still carries three engine restatements* — the last leg: `redOnBase` builds under `worktreesBase(flumeDir)` (chain-side import, as recommended); `perResolvesGate`'s queue read cites its idiom. The first two legs closed in `de865f6`. Not taken: the `FlumePaths.flumeDir` doc comment (`src/flumeApi.ts:73`) — build's lane; file it if it still reads wrong.

Delete all three questions.
