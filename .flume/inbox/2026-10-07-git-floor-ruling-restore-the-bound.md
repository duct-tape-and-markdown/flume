# Ruling: restore the git floor's reclamation-only bound at `deleteBranch`

Answers `does-branch-deletion-break-the-git-floors-reclamation-only-bound.md`
(operator, interactive session, 2026-10-07): arm **(b)**. `deleteBranch`'s
checked-out refusal reads `worktree list --porcelain` without `-z`, whose
`branch refs/heads/<name>` line is exact under either form, so below git 2.36
only reclamation degrades again, as `spec/chain.md`, *The package a chain
loads through* states. No spec edit. Not (a): Ubuntu 22.04 LTS ships git
2.34, so widening the bound would leak a branch per tick on a common host.

Ride-alongs: `src/worktrees.ts:945`'s comment names `git branch -D`, which
`deleteBranch` no longer runs; keep the ordering, restate the reason. Arm
(c), one home for the registry decode (`src/git.ts:592-593` re-spells
`src/worktrees.ts`'s field literals), is cohesion debt, not this entry.
