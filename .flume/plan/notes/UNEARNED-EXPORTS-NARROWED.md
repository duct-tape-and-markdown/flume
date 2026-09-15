# Narrowing drags narration; harness/ was already clean

22 verdicts, all LSP-confirmed: 3 deletions in `src/git.ts` (`softReset`,
`commitsSince`, `hardResetTo` — zero references anywhere, not even
in-module) and 19 types narrowed to module-local across git, partition,
Prompt, job, friction, worktrees, Dispatcher, paths, Agent,
loopSupervisor, selfPackage.

Two things for the next tick:

1. **`harness/` yielded zero candidates.** Every harness export is either
   on the `./harness` exports map or referenced cross-module. The entry's
   summary named it; nothing to do. UNEARNED-EXPORT-PIN will be green over
   `harness/` from the start.

2. **Deleting a symbol leaves prose the pin cannot see.** The three dead
   helpers were named in three surviving comments — `resetKeepTo`'s and
   `softResetTo`'s doc blocks in `src/git.ts`, and the whole-wave-revert
   comment in `src/Dispatcher.ts` — each citing a symbol that no longer
   exists. Repaired by hand here. A pin over the `exports` map catches the
   export; nothing catches a doc comment citing a deleted name. Possible
   sweep lens (dangling backticked symbol in a doc comment); not filed —
   plan's call.
