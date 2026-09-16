# The registry's widening is an API break, and the branch leg now leaks one case

`WorktreeRegistry.paths` (a `Set`) became `worktrees` (a `ReadonlyMap` path ->
branch): a path set beside a branch map would be two copies of one record git
printed. It rides `FlumeApi.git.readWorktreeRegistry`, so this is public
surface. `docs/MIGRATING-0.17.md` said "two breaking changes, and neither is
in the API" — now three, with a new section 5; `docs/CHAIN-AUTHORING.md`'s
reaper sample moved to `.worktrees`. Consumers see a typecheck error, never a
silent one.

Second-order, for spec's eyes: binding the leg to the registry means a branch
whose worktree registration git had already pruned is no longer reaped —
nothing pairs it, and the old `flume/*` glob did catch it. That is the same
trade the directory leg already takes (spec/worktrees.md says so for
directories, not for branches), so it is stated at the site rather than
parked. If the leak matters, the fix is a prune-time record, not a name glob.
