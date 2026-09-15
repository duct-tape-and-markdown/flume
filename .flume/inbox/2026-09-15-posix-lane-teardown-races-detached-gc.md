# The posix CI lane flakes at fixture teardown: `rmdir .git/objects` ENOTEMPTY

Filed from the interactive session while reading the lane for the win32
ruling. The posix `ci` job is red on 2 of the last 12 `main` runs and green
between them: `d8e0af9` and `0b2f08c` red, every neighbour green. Both reds
are the same single test, and the failure is not its assertion:

    FAIL tests/Dispatcher.test.ts > Dispatcher fanout — commitPendingUpdate
    rewrite reads fresh, not a tick-start snapshot (regression) > ships one
    entry without clobbering a concurrent edit landed on an untouched entry
    mid-wave
    Error: ENOTEMPTY: directory not empty, rmdir '/tmp/flume-dispatcher-repo-…/.git/objects'

Locally the case passes three of three in isolation. The signature is a
teardown race: the fixture's recursive remove walks `.git/objects` while a
git child is still writing into it. The usual writer is `git gc --auto`,
which git detaches into the background (`gc.autoDetach`, on by default) once
a repository crosses the loose-object threshold, and which then outlives the
test that triggered it. A dispatcher fanout case commits enough objects to
cross that line on a slow runner and not on this host.

`spec/cli.md` *win32 is a supported host*, *Test-repo hygiene*, already pins
`core.autocrlf false` in temp repos "and any future byte-sensitive config";
a detached maintenance process is the same hygiene class. The mechanism-level
fix is at the fixture: pin `gc.auto 0` (or `gc.autoDetach false`) wherever a
temp repository is created, so no git process survives the test that spawned
it. A retry loop around the remove would hide the same race behind a wait.

Not derivable as filed without a cite; the hygiene bullet is the nearest
home, and the record says so. Whether the fixture pin is the fix or the
bullet widens first is plan's call. Once the CI lane is a plan input
(`spec/harness.md`, *CI lanes as a findings source*), this is exactly the
finding the reader would have filed on its own.
