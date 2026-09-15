# cliHelp's 5s default timeout flakes under a full-suite run

Shipped as written. One observation for the queue, unrelated to this entry:

`pnpm test --run` over the whole tree failed once here on
`tests/cliHelp.test.ts` > "flume job --help names
supervisorPolicy.abortThreshold rather than a fixed consecutive-tick count"
— `Test timed out in 5000ms`. The file passed in full (12/12, ~9s) when run
alone immediately after, and the neighbouring cases in it each take
750–1700ms spawning the CLI. So the subject is the default 5s budget against
a case that shells out, not the help text: under the full suite's load the
spawn crosses it.

Every other `it` in that file carries the same shape and the same bare
budget, so the flake is the file's, not that one case's. It reverts a green
commit when it lands on a real tick (vitestGate → whole-commit revert), and
the record it leaves names no `failingFiles`, so nothing marks it a suspect
flake either. Worth an entry: give the CLI-spawning cases in `cliHelp.test.ts`
an explicit timeout sized off what they actually cost.
