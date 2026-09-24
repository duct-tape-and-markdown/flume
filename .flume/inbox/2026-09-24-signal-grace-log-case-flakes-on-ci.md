# The grace-logging case flakes on the posix lane under CI load

`tests/cli.test.ts`, "a signalled bare tick logs the wait it is entering
before its agent tree is down, naming the grace" — red on the posix lane at
e38f81e0 (run 36066310772), green on windows in the same run, and green
locally on the same tree four of four with its three siblings. Same family
as the two cases filed 2026-09-23 and fixed since; this one was not in that
record. Per `spec/worktrees.md`, *The default test lane must stay fast*, a
load-sensitive timing assertion belongs in neither lane until it is
event-based: the case should wait for the log line it asserts rather than
for a bound that CI load can miss. Observed at 624a6f25.
