# The posix lane's red is a teardown race in the SIGTERM case, not its assertion

Filed from the interactive session while declaring the POSIX lane; the
first drain will report the title, and this record carries the cause so it
is not re-derived.

The `ci` job is red on `pnpm test:integration` for runs 35014206480 and
35015953021, one test each time:

    FAIL tests/tip-claim.integration.test.ts > flume loop/tick — tip claim
    wiring > claim file (and loop.pid) are gone after SIGTERM on POSIX; …
    Error: ENOTEMPTY: directory not empty, rmdir '/tmp/flume-job-…/.flume'

The assertion passes; the failure is the fixture's recursive remove walking
`.flume` while the signalled process tree is still writing into it. Locally
the file is green twelve of twelve at 25s. The shape is the one
`TEMP-REPO-FIXTURES-RUN-WITH-AUTO-GC-OFF` closed for `.git/objects`: a child
that outlives the case it belongs to, racing teardown. Here the child is the
loop's own — the supervisor takes SIGTERM, its release handlers unlink
`loop.pid` and the claim, and its tick child (or the handler itself) is still
touching `.flume` when `afterEach` runs, because the case waits for the
files to be gone, not for the process tree to exit. On a fast local host the
window closes before the remove; on the runner it does not.

Read against the case (`tests/tip-claim.integration.test.ts`, the SIGTERM
case): it kills the recorded supervisor pid and awaits the spawned wrapper's
`exit` before asserting, so the supervisor and its wrapper are gone when
teardown runs. The writer still alive is therefore a grandchild — the tick
the supervisor had in flight — and the question is the engine's before it is
the test's: whether the loop's SIGTERM handler terminates its in-flight tick
child or leaves it orphaned, still writing into the state root it was handed.
`spec/loop.md` names the release handlers as what drops the lock and the
claim; it does not say what happens to the tick. Verified on disk: the loop's
SIGTERM handler (`src/cli.ts`, the `dropLock` handlers) unlinks `loop.pid`,
releases the claim and calls `process.exit(143)`, and nothing in
`src/loopSupervisor.ts` holds a handle to the tick child it spawned — no
kill, no wait. So the engine orphans: a `kill` of a loop leaves its
in-flight tick running against a state root whose lock and claim are already
gone, free for the next loop to take. The teardown race is that orphan's
last write. The fix is the engine's — the SIGTERM handler terminates the
in-flight tick and the exit waits for it, so the release the spec promises
is the release of the whole process tree — and the case then asserts
absence after the exit it already awaits, with nothing left to race.

Either way the fix lands at the sync point, per `spec/worktrees.md` *The
default test lane must stay fast*: a flaking test is a defect in the test or
in what it drives, never in the lane assignment.
