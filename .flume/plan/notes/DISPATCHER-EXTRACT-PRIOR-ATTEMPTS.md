# Prior-attempt extraction: stale spec cites, and an unpinned dead-import lens

Spec cites the moved symbols by old home/name, and build cannot edit `spec/`:
`spec/worktrees.md:253` and `spec/loop.md:285` say
`src/Dispatcher.ts:snapshotRevertedFiles` (now `PriorAttemptStore.snapshotReverted`,
`src/priorAttempts.ts`); `spec/loop.md:357` says `clearPriorAttempt` (now
`.clear`). Human-lane fix.

Two homes the entry did not predict. `bound`/`tailBound`/`headTailBound` went to
a new `src/bounds.ts` — Dispatcher's failure signatures and the record fields
both need them, so leaving them in either module is an import cycle or a wrong
owner. `slugify` went to `src/paths.ts`, not priorAttempts: worktree dir and
branch naming reach it too. `src/index.ts` re-exports both; public surface
unchanged.

`noUnusedLocals` is off in tsconfig.json, so nothing catches dead imports. The
loopSupervisor extraction left `spawn` and `stopFlagPath` unused in
src/Dispatcher.ts (dropped here) and four in tests/Dispatcher.test.ts
(EX_TERMINAL_MISCONFIG, EX_MOUNT_DEAD, TickVerdict, RUNTIME_IGNORES — left
alone). A tsc flag would be the deterministic rung.
