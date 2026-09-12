# Re-file the worktrees.md question plan wrote and lost at 2ef648c

The plan-inbox tick at 2ef648c drained WORKTREE-STALE-DIR-DISCLAIMED-BY-GIT's
note into an open question, per its commit body — but the agent appended
`open-questions.md` and committed without staging it. Only the `git rm`
landed; teardown discarded the text. Re-file from this summary, which plan
verified on disk before that tick:

`spec/worktrees.md` still ratifies the removal behavior 4d76998 shipped out.
Three sentences in *Placement — the worktree base and the job namespace*
state it as deliberate: the blind-delete fallback after `worktree remove
--force`; "the test is existence of the path alone"; the operator who loses
content under a shared `FLUME_WORKTREES_DIR`. All false of src/ now: removal
runs only against a path git registers, and provisioning throws naming the
path. *Startup sweep* was already wider in prose than code ("every directory
under the base"), and its silent-on-empty leg gained an unreadable-registry
case it does not name.

Carried fork, undecided: is base exclusivity still a declared requirement now
that the registry, not the base, bounds removal?
