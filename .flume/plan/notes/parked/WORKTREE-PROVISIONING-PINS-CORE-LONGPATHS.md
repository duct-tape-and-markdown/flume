# Worktree provisioning already pins core.longpaths

Premise is stale. `createWorktree` (`src/worktrees.ts`) has pinned
`core.longpaths` immediately before `git.addWorktree` since
2a760a1b `build(WIN32-FANOUT-WORKTREE-LONGPATH)`; the module split
fc246f48 carried it over, and 72762313 gave `checkoutAt` the same
pin before its own detached add. So both provisioning sites pin, the
call sites are unconditional (the win32 guard and the idempotent read
live in `pinLongPaths`), and the helper keeps two callers once the job
verbs are cut — `entry.acceptance` holds on the base tree.

`pinLongPaths`'s doc (`src/git.ts`) already names the worktree caller:
"a fanout worktree (nested at least as deep as the job dir it was
cloned for)". Only the job-dir half of that sentence dies with
THE-JOB-VERBS-AND-CHAIN-SEEDDIR-ARE-CUT, which owns the rewrite.

Unclaimed value: nothing pins the *ordering*. A spy case asserting
`pinLongPaths` is called before `addWorktree` is decidable off win32
and would be green on the base — so it is a `pins[]` line, never the
`tests[]` line this entry carries, which would revert the commit for
passing pre-fix. Refile as a pin or drop.
