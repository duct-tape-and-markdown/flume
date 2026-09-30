# The win32 ENOENT is the test's own path, and no wall happened

Premise refuted; no verdict is lost. Two facts off this tree:

1. `<worktree>/.git` is composed nowhere in `src/` — every `.git` there is a
   comment. The only composers in the whole tree are the arming's
   `writeFile` and the two evidence reads (`tests/Dispatcher.test.ts:12222`,
   `:12260`, `:12300`, `:26271`). So `ENOENT ... worktrees\boom-b\.git` is
   raised by the test file, not by a teardown or probe in `src/worktrees.ts`.
2. `failed` is only ever set `true` (`src/Dispatcher.ts:973`, `:1023`,
   `:1086`, `:1164`); the completing return omits it. The report's `expected
   undefined` on the two `waveTornDownByASlotLeg` cases is therefore
   `outcome.failed` **absent** — the wave never walled — not a verdict a
   wall dropped.

One reading covers every reported message with nothing lost: on win32 the
arming does not arm. BOOM-B's leg does not throw, so `settleSlot` runs,
teardown deletes the worktree, and the evidence `readFile(join(boomCwd,
".git"))` ENOENTs on the path it just deleted; `unclassedWalls` is then
absent, which is the third walled-wave case's `expected undefined`; and the
two slot-leg cases see an ordinary green tick.

Why the gitfile wreck stops denying there is unread. Git should fatal on
both hosts — `/flume-no-such-gitdir` is absolute on win32 too and its target
is absent, so discovery hits not-a-repo either way. Settling it needs a win32
host; a fix now aims at a described symptom.

Re-file against `tests/Dispatcher.test.ts`, not `src/`:

- The arming needs a denial proven on both hosts, or a declared skip. Its
  comment cites `platform-facts.md`, *`chmod` denies nothing on win32* as its
  reason for preferring structural denial; that denial is not structural on
  win32 either, and the fact wants a second sentence once someone reads one.
- The evidence read doubles as "the leg threw" and reports ENOENT on a
  deleted path instead of the arm the case is about.
