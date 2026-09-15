# Multi-spawn `it`s are not confined to cliHelp

Shipped as written: the render case is two `it`s (one flag each), and the
check case's real `flume check` run moved to a `beforeAll` with its own 30s
budget, so no `it` in tests/cliHelp.test.ts spawns twice. Full lane green,
~114s.

Observed while auditing: the same shape — one `it` spawning the CLI several
times, past what spec/worktrees.md's single-invocation carve-out covers —
is live across the rest of the default lane. Verified by reading the cases,
not by a count: tests/job.test.ts ("real CLI: missing <name> and nonexistent
job exit 2; live pid exits 1", 3 spawns; "non-numeric/negative --max exits 2
...", 2), tests/cliJobVerbs.test.ts ("`flume job status` and `flume status`
render the same friction ...", 4), tests/cliJobResolution.test.ts (2 cases,
3 and 2), tests/cli.test.ts (5 cases, up to 4). These are the next
candidates to time out under afterMerge contention — the cliHelp pair was
just the first to surface. Each is a mechanical split or hoist like this
one; whether the lane wants them filed as entries or swept is plan's call.
