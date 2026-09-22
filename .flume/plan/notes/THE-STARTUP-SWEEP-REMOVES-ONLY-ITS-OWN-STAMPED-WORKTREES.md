# The stale-slug leg still judges on the registry alone

`createWorktree`'s occupied-path leg (`src/worktrees.ts`) still removes
whatever git registers at the path it is about to provision — unchanged, as
the spec's "its per-wave prune and stale-slug removal are unchanged" asks.
The sweep beside it now refuses exactly that evidence. So under a base two
state roots share, provisioning still takes a sibling's live worktree out
from under it wherever the bounded dir names collide, while the sweep leaves
the same directory standing. One fact, two verdicts — worth a look, though
the collision needs equal tags in both roots.

Second: worktrees left by runs predating this commit carry no stamp, so the
sweep names and keeps them forever; an operator clears them by hand. No
adoption leg shipped — a sweep that claimed unstamped directories would be
the inference this entry deleted.
