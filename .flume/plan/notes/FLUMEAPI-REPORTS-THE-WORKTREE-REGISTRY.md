# The registry surface lands; the worktree *base* still has none

Shipped as `FlumeApi.git.readWorktreeRegistry` — the module-private probe
exported unchanged, loud union intact.

Two things the next derive may want:

1. **The base is still chain-private.** `.flume/chain.ts`'s `redOnBase`
   imports `worktreesBase` from `../src/paths.ts` and says so at the site
   ("a downstream chain would need it on `FlumeApi.paths`, filed the day
   one asks"). This entry answers *which worktrees exist*, not *where the
   engine puts them*. A reaper keying handles by the `worktreePath` its
   `setupWorktree` was handed needs neither; a chain placing its own
   throwaway worktree needs the base. Same rule (`engine-boundary.md`,
   *Surface, not prescription*), still open.

2. **The list includes the primary checkout**, because it is git's list and
   filtering it would be the engine deciding what is residue. Documented on
   the field and in CHAIN-AUTHORING.md, but it is the one place a naive
   consumer can hurt itself — worth a glance if a downstream report ever
   mentions a reaper touching the trunk.
