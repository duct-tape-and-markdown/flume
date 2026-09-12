# existsSync existence gates left outside fsProbe

Shipped as written: `isAwake` now reads through `existsLoud`, and the
`namespacedJoin` source scan (tests/Baton.test.ts:120) swapped `existsSync`
for `existsLoud` in the same commit — the probe takes a pre-joined path, so
it belongs in that list exactly as the bare `node:fs` calls do.

Observed while grepping: six `existsSync` existence gates remain in `src/`,
each deciding what happens next off a path's presence —
`Dispatcher.ts:655` (a read that returns undefined on "absent"),
`git.ts:292,432-433,565` (lock/rebase-state/tip-claim probes, all already
spelling `toNamespacedPath` by hand), `worktrees.ts:178`,
`setupWorktree.ts:63-64` (lockfile choice), `cliJobResolution.ts:52`
(the `.flume` ancestor walk). Each collapses EACCES/ELOOP to "absent" the
way the stop flag, tip claim, loop pid and now `isAwake` did. Same section,
same shape; the dispositions differ per site (git.ts:565's claim probe looks
load-bearing, the ancestor walk may want to stay silent by design), so they
want per-site triage rather than one sweep entry.
