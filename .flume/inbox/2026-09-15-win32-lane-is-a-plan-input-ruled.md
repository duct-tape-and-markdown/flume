# Ruled: win32 stays supported, and the Windows lane becomes a plan input

Closes the open question *The windows lane has been red for every run in the
visible history, and nothing blocks on it*. Option 1, with the mechanism the
question said it lacked. The operator has Windows consumers; the claim stays,
and the work is making it true.

**The spec condition is rewritten to one the loop can hold.** `spec/cli.md`
*win32 is a supported host* no longer ties support to a red suite blocking a
merge — a loop that commits straight to `main` cannot block on a lane that
runs after the push. Support is real while the lane is *read*: the lane runs
on every push to `main`, its failing titles are findings the inbox slice
drains, and a red lane is a queue, never silence. A win32 fix carries the
lane-observed input as its fixture, per the platform clause of *A fix ships
the test that would have caught it*.

**The package owns the reading.** `spec/harness.md` gains *CI lanes as a
findings source* under *What the package owns*, and the declaration table
gains `ci`: workflow file, job name, lane name. The inbox slice reads the
latest completed run for the tip's branch through the forge CLI (`gh` on this
host — a host prerequisite the way the language server is), keys findings by
lane and title, does not re-file a title already heading an entry or a
question, closes one the latest run reports green, and renders a lane it
cannot read as unread, never green. Every consumer with a CI lane gets this
by declaring it; none copies it.

**What derive files, in order:**

1. The `ci` field and the inbox-slice source in `harness/`, with this repo
   declaring `ci: [{ workflow: "ci.yml", job: "windows", name: "windows" }]`
   in `.flume/declaration.ts`. The first drain of the live lane is the
   agreement case: the real run's failing titles through the real reader.
2. The three test-harness families the closed question sized, each with its
   CI-observed input as the fixture: fault injection that `chmod` cannot
   perform on win32 (every "unreadable" / EACCES case resolving instead of
   rejecting), temp paths composed off `tmpdir()` in 8.3 short form against
   git's long form (a `realpath` on both sides), and symlink creation refused
   without Developer Mode (a declared prerequisite or a platform-conditional
   fixture, never a silent skip). The two win32 path-limit tests that have
   never passed on win32 belong to the same pass.
3. Whatever stays red after those is engine work, and the lane reader files
   it from the next run.

The cut does not wait on the program: 0.16.0 ships under the amended claim,
which is true the moment the lane is read.

The question closes; the spec holds the ruling.
