# A worktree with uncommitted edits is torn down silently; the tick reads as merged

Observed at 2ef648c: the plan-inbox agent appended `open-questions.md`, then
committed without `git add`. The commit carried the staged `git rm` alone;
the engine gated it green, cherry-picked it, and `teardownWorktreeInstance`
(`src/worktrees.ts`) removed the worktree over a tracked file with unstaged
modifications. The verdict says `merged`; the question the commit body
describes exists nowhere. Nothing logged it.

`engineering.md`, *A fact the engine holds is reported, never rediscovered*
and *Loud or nothing*: the dispatcher can read `git status --porcelain` in
the worktree after the agent exits and before teardown. A modified tracked
path left uncommitted is a fact that belongs on the tick verdict and on
`GateContext` beside `touchedPaths`, so a chain can refuse the tick — this
chain would. The engine reports; the chain judges (`engine-boundary.md`). A
prompt line telling agents to `git add` is the bottom rung, not a
replacement for the fact.
