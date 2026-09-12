# Two more §3 sites carried the same retired premise

The `Fanout only` bullet was not alone. `docs/CHAIN-AUTHORING.md` §3's
Singleton subsection still said singleton "run[s] in the main repo (not a
worktree) and commit[s] directly to the trunk. Their `afterCommit` gates run
on the trunk" — the premise the entry's defect rests on, three headings
above it — and §2's `Respect ctx.cwd` bullet scoped in-worktree gates to
fanout. Both fixed here against `spec/chain.md`, *Both concurrencies reach
both gate points*. Worth a sweep pass: the 0.12 singleton-worktree change
looks under-propagated in `docs/`, and the retired-claim lens keys on
deleted spec lines, which would not catch these (the old claim was never
spec text).

Left alone deliberately: `docs/MIGRATING-0.10.md:362` ("in a fanout
worktree-setup hook") and `docs/MIGRATING-0.12.md:29`. Version-stamped
migration guides are dated records — accurate for the release they
describe, and 0.12's entry is the announcement of this very change.
