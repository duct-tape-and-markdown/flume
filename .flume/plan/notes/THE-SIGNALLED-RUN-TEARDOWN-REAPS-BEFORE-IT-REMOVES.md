# The teardown's kill list had drifted from what the run recorded

The entry's diagnosis (signal without wait) held, and the wait is in:
`reapAll` (`tests/cli.test.ts`) signals the whole set, then blocks on
`waitFor` until no pid answers signal 0, and both drivers' `cleanup` and both
`afterEach` hooks go through it before any `rm`.

Second defect found at the site, beyond the entry's text: each driver's
`cleanup` kept a *hand-listed* subset of the pids `record` collected —
grandchild, parked/agent, and the tsx spawn handle. The pid the CLI itself
wrote (the loop supervisor from `loop.pid`, the tick from the tip claim) was
recorded for the hook and never killed by the cleanup that did the removal,
though the comment at the `record` call says in as many words that the handle
is not the process which took the locks. So the likeliest live writer over
`<scratch>/.flume` was the one process teardown never signalled. Both cleanups
now reap the recorded list itself, so the two can no longer drift.

Worth a sweep read rather than an entry: this is the derived-state shape
(`engineering.md`, *Derived state is computed, never restated beside its
source*) in a test helper — a second list kept in sync with `record` by
discipline. Fixed here; noting it in case the family shows up elsewhere in
`tests/helpers/`.

No `tests[]`, as the entry declared: the wait's absence is a race, and a case
that reds only when a writer happens to still be exiting is not decidably red
on the pre-fix tree. What is decidable — that cleanup signals every pid it
recorded — is only observable through the removal it protects, so it stays
unpinned too.

`pnpm test` green (72 files, 1931 passed); the ten signalled-teardown arms
green on their own run as well.
