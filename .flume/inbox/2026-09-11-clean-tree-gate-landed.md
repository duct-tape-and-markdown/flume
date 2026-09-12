# The chain now refuses a commit that leaves work uncommitted; the engine leg stays open

Answers the chain half of "A worktree torn down with uncommitted tracked
edits reads as merged" (PARKED), in this commit from the interactive
session: `cleanTreeGate` in `.flume/chain.ts`, `afterCommit` on build and
every plan slice. It reads `git status --porcelain` at the worktree root
after the agent's commit and refuses on any tracked path modified or
deleted, or any untracked file inside the phase's writable paths, naming
each. An untracked file outside the fence is not the tick's and is ignored.
Pinned in `tests/chain.test.ts`: "clean-tree: a tracked edit or a writable
untracked file left uncommitted after the commit is refused by path" — red
on the pre-gate chain, green now.

What this closes: the observed incident (2ef648c), loudly — the tick
reverts with the paths in its prior-attempt record. What it cannot reach:
a tick that commits nothing, where no gate runs. Amend the question to that
leg alone; the `spec/loop.md` ratification it cites still governs it.
