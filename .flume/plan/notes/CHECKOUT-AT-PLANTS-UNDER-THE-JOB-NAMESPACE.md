# afterMerge runs the named-lines suite ahead of tsc, so a signature drift reported as a test failure

This entry's prior attempt was reverted at `named lines` with a path-equality
assertion in tests/harnessRunner.test.ts. The real defect was a type error:
that attempt changed `withGateCheckouts`'s signature while
RUN-AT-BASE-USES-THE-ENGINE-CHECKOUT landed a new caller (`inGateScope`) in
the same window. The worktree's afterCommit tsc could not see that caller, and
vitest never typechecks — so on the merged tree the stale positional ran as
`undefined` and placement silently fell back to the default base.

The merged tree's tsc would have named the file and line in seconds, but
`harness/chain.ts` places the package's own gates before the consumer's, so a
minutes-long suite runs ahead of the cheap typecheck at afterMerge and the
revert record carried the wrong file. Cheapest-first at afterMerge (the order
afterCommit already effectively has) turns a cross-entry signature drift into
a one-line report. Fixed here by updating the caller; the ordering is not.

(The builtinGates npm/tsc flake in the same revert is already in the inbox.)
