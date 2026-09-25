# Where does an empty span land — a fifth no-commit mode, or a refusal before the merge stage?

Field report, 0.19, seen twice: a plan tick with nothing to drain committed
anyway; the commit's diff against trunk was empty; `cherryPickRange` failed
with `Command failed: git cherry-pick A..B`; the failure was recorded as a
**merge-stage** failure, and a merge-stage failure quarantines the entry for
the rest of the run.

Measured this tick on a scratch repo: `git cherry-pick <base>..<head>` over a
commit with an empty diff exits **1**, prints "The previous cherry-pick is now
empty", and leaves the repository mid-cherry-pick — which the engine then
aborts. So the engine's classification is not wrong about what git said; it is
wrong about what happened.

`spec/loop.md`, *The no-commit taxonomy* says "a tick that produces no usable
commit is classified as exactly one `NoCommitMode` — four causally-distinct
modes", and the four are declared once as `NO_COMMIT_MODES`. An empty span
produces no usable commit and is none of the four: `clean-exit` is spelled "the
agent exited cleanly **without committing**", and the engine reaches it only
through `headSha === spanBase` (`src/tickAttempt.ts`), which an empty commit
moves past.

The spec is silent, so this is yours. Four ways it could land:

1. **A fifth `NoCommitMode`.** An empty span is its own cause and reads as one
   in a verdict: the agent ran, committed, and changed nothing. Costs a
   widening of a union the spec calls closed at four, and every exhaustive
   table over it (`RESOLVED_BY_A_PRODUCER`, `PLAN_RESOLVES_STANDING`, `PUT_DOWN`)
   gains an arm — which is the mechanism working, since each is a compile error
   until classified.
2. **Widen `clean-exit`.** "The agent decided there was nothing to do" is the
   same fact whether it committed an empty marker or nothing at all, and the
   existing refusal (a producer resolves a clean exit) is already the right
   disposition. Costs the section's own wording, which says "without
   committing", and loses the distinction between an agent that declined and
   one that committed noise.
3. **Refuse at `afterCommit`.** An empty commit is a defect in the tick, so
   gate it before the merge stage ever sees it and let the existing
   `gate-revert` path carry it. Keeps the taxonomy closed; makes "commit
   something empty" a hard error rather than a no-op, which may be the honest
   reading of "one tick is one commit (or zero)".
4. **`--allow-empty` and ship it.** Cheapest; leaves an empty commit on trunk
   per quiet tick, and hides the chain's own bug.

Whichever you pick, the quarantine is the sharp edge and is separable: an empty
span is not a *merge* failure, so it should not reach the merge-stage
quarantine leg at all (`src/loopSupervisor.ts`). If you want only that part
now, say so and it files as an entry against *Repeated identical failures —
quarantine, then abort* on its own.

Not filed as an entry: every option above changes what `spec/loop.md`, *The
no-commit taxonomy* states the closed set is, and that file is yours.
