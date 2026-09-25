# The inbox window renders records from the primary checkout's disk, not from the tip its worktree was cut at

Observed at 70bb7045 → db75a751: a drain routed ten records it could not
`git rm`, because its worktree's base predated the operator commit that
added them; the window had read them off the primary checkout's state root,
where they already existed. The next tick, cut from the newer tip, removed
them. Self-healing, but the seam is `spec/pending.md`, *Dispatch reads come
from the tip, not the tree*: a decision a plan tick acts on — which records
it drains, deletes, and stamps as drained — should come from the tree its
commit descends from, never a disk two writers share. Under one tick the
two never diverged; under two and an operator committing beside the run
they do. Route: the record listing and the record reads the window renders
resolve against the worktree, or the tick refuses when the two disagree.
