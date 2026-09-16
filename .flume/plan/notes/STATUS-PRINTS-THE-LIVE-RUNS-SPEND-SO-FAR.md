# The run's start instant is read off loop.pid's mtime

spec/cli.md line 7 bounds the spend to "the verdict rows written since it
started", and nothing on disk states when a run started: spec/loop.md ("The
loop lock and the tip claim") pins loop.pid's contents to "the holder's pid,
nothing else". So status dates the window from the lock file's mtime — the
supervisor writes it once, at claim, never rewrites it — and keeps a row when
its `at` is at or after that. It is a measurement of an engine action rather
than a statement the engine made (engine-boundary.md, *Told, not inferred*);
if the cleaner shape is for the supervisor to say its start time outright,
that is a spec/loop.md change to loop.pid's contents, not a build decision.
`TickVerdict.at` became load-bearing for this one reader; its doc says so.

Adjacent, not filed: docs/CLI.md § `flume status` still claims the stdout a
watch loop parses "stays byte-unchanged" when the chain fails to load, which
the `chain: failed to load` row it now prints on stdout contradicts.
