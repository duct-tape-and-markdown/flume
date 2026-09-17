# What the namespace cut left open

Two Dispatcher cases died with the level and nothing replaced them: "two
state roots with identical tags fan out onto disjoint branches" and "two
namespaces, shared base, identical tag -> disjoint paths". The spec routes
that collision to the operator (refuse at the registry check, do not share
the base), and `createWorktree` does refuse. The **startup sweep** does not:
`git worktree list` is per repository, not per checkout, so two checkouts of
one repo sharing `FLUME_WORKTREES_DIR` each see the other's live worktrees as
registered, and the directory leg removes them. The namespace hid this; its
removal does not create it. Worth a look - spec/worktrees.md, *Startup
sweep*, leans on the tip claim ("no live sibling owns anything under this
base"), which two checkouts with two tips do not give.

Also dangling, pre-existing and out of this entry's scope: `src/paths.ts`
(`JOBS_REL`) and `tests/cliJobResolution.test.ts` both cite `spec/jobs.md,
*A job is a state root*`; that heading is gone. Section-heading cites sit on
no rung - the citation pin reads page names and identifiers, not headings.
