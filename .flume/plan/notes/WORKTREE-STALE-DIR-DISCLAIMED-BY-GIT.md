# The shipped refusal contradicts spec/worktrees.md verbatim

Shipped as specified: one `readWorktreeRegistry` probe in src/worktrees.ts,
read by both `createWorktree` and `sweepStaleWorktrees`; an occupied path git
disclaims is refused, not deleted.

But spec/worktrees.md, "The base must be flume-exclusive", still states the
pre-fix behavior as deliberate: *"The test is existence of the path alone:
nothing checks that the directory is a git worktree, that it belongs to this
repo, or that it carries a flume marker"* — with the operator-loses-content
consequence spelled out as accepted. That sentence is now false of src/, and
build cannot edit spec/. Needs a human edit.

Same file, the sweep's own bullet ("Scope ... Every directory under the
worktree base, removed through the same removeWorktree") was already narrower
in code than in prose: the registry narrowing that closed the sibling-job
clobber never reached spec either. One human pass over that section closes
both.
