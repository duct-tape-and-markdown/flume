# Ruling: pin the CLI fixtures against ancestor discovery, then find the writer (human)

Closes *A leaked /tmp/.flume/stop red-lines the default lane*. Both forks,
in this order. First, the CLI test fixtures root their temp repos where no
ancestor can hold a state root — a sentinel-rooted base or an env override
the discovery honors — so `tmpdir()`'s parents are unreachable; this bounds
the blast radius whatever the writer turns out to be, and is the fix that
ships its test (a planted ancestor `.flume/` must not change the fixture's
verdict). Second, a separate entry: find which test writes `/tmp/.flume`
and stop it; if it cannot be attributed in one tick, say so in the note.
