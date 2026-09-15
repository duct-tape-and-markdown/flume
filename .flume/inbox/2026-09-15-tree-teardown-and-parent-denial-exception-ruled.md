# Ruled: a signalled loop takes down its whole tick tree; a descending reader's case may deny a parent

Closes two open questions: *A signalled loop's teardown stops at the tick
child, and nothing bounds the wait it does make* and *The never-deny-a-parent
rule has no exception for a reader that descends*. The grace is a supervisor
policy knob, chain-overridable like the other five, per `engine-boundary.md`
*Routing rule* — the question's own routing.

**`spec/loop.md` *The loop lock and the tip claim*, the *Release* bullet.**
The kill now reaches the tick child and stops there; the agent that tick
spawned is a grandchild with its own pid that survives, still writing into
the tick's worktree, and the supervisor's await is bounded only because the
child happens to install no handler. The bullet now says the release is the
whole tree's: on POSIX the tick child runs in its own process group, the
handler signals the group with `SIGTERM`, escalates to `SIGKILL` after a
bounded grace the supervisor declares, and waits — so no writer is left on
the state root when the claim goes, and the await cannot go unbounded
whatever a child installs. A bare `flume tick` takes its agent down the same
way. Win32 keeps what it had: no handler runs, stale-reclaim is the
guarantee, which the section already scopes. Process-group teardown is
POSIX-hostile to nothing and win32-hostile only where nothing runs anyway.

**`platform-facts.md` *win32 reports a path through a non-directory as not
found*.** The page said never deny a fixture's parent, and the descending
readers this run shipped are exercised only by an obstructed ancestor. The
page now names the exception as the rule's converse: a case pinning a reader
that carries the descent denies the parent on purpose and says so at the
site, which is exactly what `tests/priorAttempts.test.ts` and the merging-
markers case already do.

What derive files: the process-group leg on the supervisor's signal path and
the bare tick's, with the grace as a supervisor knob the declaration passes
through like the other five; a pin that the await is bounded by the
escalation, not by the child's handler set.
