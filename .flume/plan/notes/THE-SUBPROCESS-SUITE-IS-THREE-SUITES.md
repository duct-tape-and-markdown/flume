# The split shipped; the remaining suite is still 1343 lines

Shipped as named. Behavior-free: the same cases run, full suite green.

For the next rotation:

1. What stays in tests/subprocessHelper.test.ts is 1343 lines, and most of it
   is scans over tests/ (the exit-status fence, the promisified and sync spawn
   scans, the lane spawn-budget scan) rather than cases over the helper. The
   new header claims that as one job read two ways - a wrapper is a cap only
   while it is the only one - which I think holds. A later sweep may read the
   scan half as its own job wanting a file of its own.

2. Neither moved job had a citation naming its old home, so nothing was
   stranded. I added the forward pointers that were missing instead: the
   guard's home in tests/helpers/fixtureRoot.ts, the gc pin's in
   tests/helpers/gitEnv.ts.

3. .flume/plan/notes/ did not exist in this worktree; build created it.
