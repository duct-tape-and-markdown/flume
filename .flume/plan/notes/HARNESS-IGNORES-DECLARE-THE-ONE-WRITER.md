# cliHelp's spawn tests time out under full-suite load

Observed validating this entry: `pnpm vitest run` (whole suite) failed two
`tests/cliHelp.test.ts` cases on the default 5s per-test timeout — "no help
text (flume --help, flume -h) names render" and "flume check --help names the
no-fanout skip among the ways check exits 0". Run alone the file is green in
~10s (8/8). Both spawn the CLI as a child process, so they are competing for
the box with 43 other files rather than asserting anything wrong.

Why it matters: the suite is a build gate. A timeout-flaky file makes a green
tree revert a correct commit at random, and the failure reads as a regression
in whatever entry happened to run. The fix is a timeout on the spawning cases
(or the file), not on the assertion — which of the two is plan's call.

Nothing in this entry touches the CLI surface; filed here rather than acted on.
