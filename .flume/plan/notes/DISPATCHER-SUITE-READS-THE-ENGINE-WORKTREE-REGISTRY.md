# One positive site was red on win32, not green over nothing

All seven `worktree list` spawns are gone; every worktree verdict is exact
membership over `registeredWorktrees()` (one file-level helper, throws on
`read:false`). The `checkoutAt` suite's local `registered()` now routes
through it too, so the file holds one reading of the registry.

Worth plan's attention: the entry read three sites as vacuous-green on
win32, but site ~3391 (`the startup sweep reads the chain-declared base`)
was a *positive* `toContain(orphan)` over a host-separator absolute path.
git prints forward slashes, so that assertion should have been failing
outright on the windows lane, not passing. Either the lane has been red, or
it does not reach this file. Same question applies to the old
`toContain(siblingPath)` at ~3484. Both now compare `resolve`d paths, which
fold either spelling to the host's — so the suite no longer answers it.
Somebody should check whether the windows lane is actually green.
