# run-end.json is in RUNTIME_IGNORES; spec/jobs.md's listing is not

**Spec gap, human edit.** `tests/harnessIgnores.test.ts` pins every
`STATE_ROOT_NAMES` value into the derived consumer ignore set, which is
`RUNTIME_IGNORES` filtered by that record — so the new name had to join the set
or the pin reds. `spec/jobs.md`, *Runtime ignores* carries a fenced listing of
the set, and it now lacks `run-end.json`: the mechanical side won, the prose
side is one line stale. The repo's own root `.gitignore` carries the line (the
second half of that pin); `.flume/.gitignore` picks it up at the next `loop`
start through `ensureRuntimeIgnores`.

**The record carries the child's exit code, not the run's.** `loopExitCode`
lives in `src/cliVerdict.ts`, which imports `src/loopSupervisor.ts`, so the
supervisor cannot compute the run's own exit code without a cycle. The record
states the `flume tick` exit code where a child's exit decided the end
(mount-dead, terminal misconfiguration) and nothing where none did. If an
operator wants the run's exit status on the record, that is a decision about
where `loopExitCode` lives, not a patch at the write site.

**The win32 laneTest proves the teardown, not OS delivery.** `process.kill(pid,
"SIGBREAK")` is not a delivery path — libuv's win32 kill maps SIGTERM/SIGKILL/
SIGINT to `TerminateProcess` and refuses the rest — and nothing in the tree can
call `GenerateConsoleCtrlEvent`. So the arm runs the real
`installSignalledTeardown` in a child and emits the signal through node's own
listener dispatch, twice (SIGTERM and SIGBREAK), comparing the traces. The
console-ctrl-handler half is node's, unpinned here.

**Still undocumented, and was before this entry:** the status stop-flag line
(spec/cli.md line 4) appears in neither `flume status --help` nor
`docs/CLI.md`'s status paragraph. I added the run-end clause to both; the
stop-flag omission stands and is a doc entry of its own if plan wants it.
