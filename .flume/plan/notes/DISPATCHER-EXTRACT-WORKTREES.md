# Five spec cites now name the wrong module

The move landed; `spec/` still points the worktree lifecycle at
`src/Dispatcher.ts` and build cannot edit it. All five want `src/worktrees.ts`:

- `spec/worktrees.md:21`, `:61` — "`src/Dispatcher.ts:createWorktree`"
- `spec/worktrees.md:95` — "`worktreeDirName(tag)` (`src/Dispatcher.ts`)"
- `spec/loop.md:92`, `spec/jobs.md:54` — "`Dispatcher.createWorktree`"

`Dispatcher.sweepStaleWorktrees` stays a method (cli.ts calls it), so the
startup-sweep section needs no cite change.

Two observations for the next rotation:

- The four helpers shared five dispatcher values, so they take one
  `WorktreeContext` rather than three per-function shapes. It is a superset of
  `FrictionHarvestContext`, so teardown hands the harvest that value directly
  — the copy that used to be rebuilt at the call site is gone.
- `WORKTREE-BASE-RESOLVED-ONCE` moved with its subject into
  `tests/worktrees.test.ts` and now keys on `worktreesBase(` rather than
  `worktreesBase(this.flumeDir)`. The claim is that both consumers reach the
  resolver, not how either spells its state root; the old spelling would have
  gone red on a rename that changed nothing.
