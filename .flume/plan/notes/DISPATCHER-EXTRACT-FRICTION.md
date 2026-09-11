# Three spec cites now name the wrong module

The move landed, but `spec/` still points friction at `src/Dispatcher.ts` and
build cannot edit it:

- `spec/cli.md:136` — "`frictionCountLine` (`src/Dispatcher.ts`)" → `src/friction.ts`
- `spec/chain.md:319` — "`src/Dispatcher.ts:loadChainModule` → `validateFrictionDeclaration`":
  the loader stays, the validator is now `src/friction.ts`
- `spec/worktrees.md:296` — "`src/Dispatcher.ts:harvestFriction`" → `src/friction.ts:harvestFriction`

Two observations for the next rotation:

- `writeRevertNote` stayed in `Dispatcher.ts` — it is the fourth friction
  writer, but it is built from a commit message only the dispatcher reads
  (`capturedCommitMessage`). Declared at the top of `src/friction.ts`. If a
  later entry wants the channel's writers in one home, that reader moves with
  it; `spec/worktrees.md:276` cites it by module too.
- `assertStateRootRelative` fell out of the split into `src/paths.ts`: the
  friction and `pendingPath` validators both reach it, and a copy on either
  side is how two escape rules drift. Same shape as `bounds.ts` in
  DISPATCHER-EXTRACT-PRIOR-ATTEMPTS.
