# A sibling tick's mount-dead exit aborts the run its peer had just repaired

Run of 2026-10-07T16:33:59Z, `maxTicks` 2. The queue held two entries
carrying the retired `priority` key, so it failed the strict parse. The
supervisor started `build` and `plan-inbox` together. `plan-inbox` was told
the parse failure as a tick fact and repaired both files (`1d98eeee`,
cherry-picked 16:35:18.054Z). The `build` child exited 69 on the same parse
failure, and 227 ms later the supervisor aborted the run ("tick exited 69
(mount-dead) … aborting after 2 tick(s) … Restore what it named, then
re-run") with the cause already restored on the tip.

`spec/cli.md`, `spec/loop.md` (*Exit codes*) say 69 means a fresh process
reads the same unparseable file "until the queue's declared writer runs over
it" — and here the declared writer was running, as a sibling, and won. The
abort keys on a child's exit, not on whether the named cause still holds at
the tip the supervisor is about to dispatch from. Under `maxTicks` 1 the
same queue would have sent `plan-inbox` first (declared writer, the
unparseable-queue route) and never started the build child.

Two candidate shapes for plan to weigh: (a) the supervisor does not start
a phase that cannot parse the queue while a declared writer of it is
running over the failure; (b) a 69 whose cause the tip no longer holds is
not run-fatal — re-read before aborting. Repro: two queue files with an
unknown core key, `maxTicks` 2, `build` and `plan-inbox` awake.
