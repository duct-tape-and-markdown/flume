# One porcelain walk now, at `-uall` for both callers

`statusRecords` asks `--untracked-files=all` unconditionally (the gate needed
it; `trackedModifications` drops `??` either way). That widens what
`trackedModifications` *walks* — not what it returns — on every agent worktree
at teardown (`src/Dispatcher.ts:2287`, `:2639`): git now descends untracked
dirs file-by-file instead of reporting one directory record. Ignored trees are
still skipped, so the cost should be noise, but it is unmeasured and it rides
the hot teardown path. If a fanout wave ever looks slow at teardown, this is
the first thing to measure.

One porcelain call left outside the decode: `src/job.ts:328` runs `status
--porcelain -- <pathspec>` as an emptiness probe (`staged.length > 0`), never
decoding a code or a path. `statusRecords` takes no pathspec so it cannot
serve it as written. Not filed — it is not a record walk — but a future sweep
reading "one porcelain walk in the tree" will find it and should know it was
seen and left deliberately.
