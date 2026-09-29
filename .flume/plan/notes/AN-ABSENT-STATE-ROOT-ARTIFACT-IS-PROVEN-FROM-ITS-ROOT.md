# One bare state-root stat is left, and the stop-flag legs are untestable here

Landed: the four `src/tickVerdict.ts` readers, both stop-flag probes
(`src/loopSupervisor.ts`, `src/waveTick.ts`) and the prose at each now take
`existsLoudUnder`. Two new cases in `tests/Dispatcher.test.ts` obstruct the
state root with a plain file; both fail on the pre-fix tree with node's bare
`ENOTDIR`.

Two things for the next tick.

1. `PriorAttempts.read` (`src/priorAttempts.ts:381`) is the same defect, and
   it is the load-bearing one left: a bare `existsLoud` over
   `priorAttemptPath`, whose silent arm is "no prior attempt". That arm is
   what spec/loop.md's quarantine/abort count reads, so an obstructed state
   root resets the count on win32 rather than refusing. Its sibling
   `readAll` already descends (`isDirectoryOrAbsentUnder`, :486), so the fan
   read and the single read disagree about what absence they can prove. The
   remaining `existsLoud` callsites (`src/git.ts`, `src/chainLoad.ts`,
   `src/setupWorktree.ts`, `src/cliStateDirs.ts`, `src/worktrees.ts`,
   `src/selfPackage.ts`) are over repo/package paths, not state-root
   artifacts, and `src/Baton.ts:145` already sits past `dirStands()`.

2. The two stop-flag legs ship with no test of their own, and I do not think
   one is reachable: the flag sits directly under the state root, so the only
   rung the descent adds is the root itself — and a live supervisor or wave
   necessarily has a directory there (it wrote the lock and the baton flags
   before reaching either probe). The change there is one spelling with
   `src/cliLoop.ts` / `src/cliStatus.ts` plus win32 uniformity, not an
   observable behavior delta on this host. If a future entry wants it pinned,
   the reachable shape is a fake state root handed to the probe directly, not
   a driven run.
