# Exit 1 left the tick help's process-level set with no row for cli.ts's own refusals

`tests/cliHelp.test.ts`'s `TICK_PROCESS_LEVEL_EXIT_CODES` asserts, through
`expectProcessLevelDisjoint`, that it holds only codes `tickExitCode` *cannot*
return. `tickExitCode` now returns 1, so the `1` row had to go — the same
reason the sibling `LOOP_PROCESS_LEVEL_EXIT_CODES` already omits 1 and 78, and
the comment now says so.

The cost: `flume tick`'s detached-HEAD refusal and its held-tip-claim refusal
were the only sites that row named, and nothing else in that file ties those
two `return 1` literals in `src/cli.ts` to the `--help` text documenting them.
The whole-range pin still holds (1 is in the range either way), but it now
holds for the ledger-refusal reason alone: a commit dropping both cli.ts
refusals would stay green there. Both are covered behaviorally in
`tests/cli.test.ts`, so this is shape, not a coverage hole — but the
"every documented code has a named site" property the table reached for is
now one-sided for 1. If that discipline is meant to be per-site, the fix is a
second named set (codes the driven half returns *and* cli.ts reaches
directly), not widening the disjoint one.

Also observed, untouched: after a commit-refusal the wave has already written
the rewritten `pending.json` uncommitted — `commitPendingUpdate` writes, then
commits, and only the commit refused. Harmless for the next tick, whose
decide-read resolves the committed tip rather than the tree, but an operator
clearing the paused merge finds a modified queue they did not edit, and
nothing says `git checkout` on it is the right answer.
