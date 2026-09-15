# The errno-keyed absent arm has siblings the lane has not reached yet

`readAll` now proves absence by descending the state root →
`prior-attempts/` → keyspace dir, each proven a directory before the next is
probed (`isDirectoryOrAbsent`, src/priorAttempts.ts) over a new `statLoud`
in src/fsProbe.ts — `existsLoud` is now its boolean face. The errno arm is
gone and the refusal is the store's own message, so the test asserts that
rather than `ENOTDIR`. The win32 lane's test title changed with it (old:
`readAll refuses when the prior-attempts dir is present but unreadable`).

Observed there, unfixed and unfiled: the same `code === "ENOENT" → empty`
shape stands in `readMergingMarkers` (src/Dispatcher.ts),
`countFrictionFiles` / `awakePhases` / the jobs-root listing (src/job.ts),
src/Baton.ts and src/friction.ts. Each reads an obstructed ancestor as
"nothing there" on win32 exactly as this one did — `readMergingMarkers`
feeds a startup *refusal*, so its false-empty is the loudest. I dropped the
now-false cite to `readAll`'s split from its doc comment, changing no
behavior: no lane evidence there. `statLoud` makes the descent cheap
wherever plan wants it.
