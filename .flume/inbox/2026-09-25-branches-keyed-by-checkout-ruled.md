# Ruled: tick branches and entry claims are keyed by the checkout

By the operator, priority 30, beside field report item 4. Two linked
checkouts of one repository share one ref namespace (verified: the second
cannot create a `flume/plan-derive` the first holds), so the spec's own
recipe for two efforts collided on any singleton phase run at once, and
`spec/jobs.md`'s "Why" claimed a keying the engine did not do.

Spec, this ruling's commit: branches are `flume/<checkout>/<slug>`
(`spec/worktrees.md`, *Fanout is the engine's declared navigation
carve-out* and *Singleton runs in a worktree*; `spec/loop.md`), entry claims
are `<git-common-dir>/flume/claims/<checkout>/<slug>` (`spec/pending.md`,
*Claims*), and `spec/jobs.md` says why. The ship and worktree locks stay
shared. One entry: the checkout segment, with a case where two linked
checkouts each provision `plan-derive` at once and both succeed. A dead
wave's residue under the old names is still reaped, since the reap is bound
by the registry, not by the name.
