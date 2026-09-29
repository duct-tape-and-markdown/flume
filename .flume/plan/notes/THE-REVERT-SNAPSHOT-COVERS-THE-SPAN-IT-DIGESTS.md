# The revert snapshot now spans base..head

Shipped as specified. Three things for the next tick.

**A measured git fact, not in platform-facts.md yet.** `git diff --name-only
base head` compares two trees, so a path an earlier commit in the span created
and a later one deleted is named by *neither* side and never reaches the
listing. `--diff-filter=d` therefore only drops paths the base already held.
Consequence for the guarantee: the snapshot covers what the span's head still
holds, so prose an agent wrote and then deleted inside one span is still
unrecoverable — correctly, since no post-image exists, but the spec section
does not say it. Pinned at both layers (`diffNameOnly` in tests/git.test.ts,
the store in tests/priorAttempts.test.ts).

**The spec sentence is still narrower than what ships.** "every non-deleted
file the reverted **commit** touched" — already in this tick's spec question.
Code and doc comments now say span; that sentence is the human's.

**A pin changed shape, deliberately.** tests/Dispatcher.test.ts's
"derives the footprint from runAfterCommitGates' own gate-loop capture"
counted `diffNameOnly` calls at exactly 1. The snapshot adds a second read of
the same range under `excludeDeleted` — a different selection, not a copy of
the footprint — so the pin now counts by argument shape: exactly one
unfiltered read, exactly one filtered. It keeps its teeth (a reintroduced
duplicate is a second unfiltered read) and the filtered half doubles as proof
the snapshot ran on that path. Worth a plan read if the intent was the bare
total.

**Debt, not filed.** `revertAfterCommitFailure` drops `span.head` alone while
snapshotting the whole span. Correct today because the worktree branch dies
whole after an unshipped tick, so nothing depends on the drop reaching the
earlier commits — but the two legs now disagree about what the reverted unit
is, and that agreement is load-bearing if any path ever keeps the branch.
