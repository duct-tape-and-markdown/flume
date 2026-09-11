# The docs restate the base formula with no pin to the resolver

`src/` now has one worktree-base resolution (`worktreesBase`, `src/paths.ts`);
`createWorktree` and `sweepStaleWorktrees` take it from there, and
`tests/Dispatcher.test.ts` refuses a second reader of `FLUME_WORKTREES_DIR`
anywhere in `src/`.

Two docs still spell the formula by hand: `README.md:226` and
`docs/CHAIN-AUTHORING.md:759` each carry
``FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")`` as prose. Both sit
outside this entry's fence, so neither was touched. They are correct today,
but they are a third and fourth copy of the thing this entry existed to
single-source — and the copy that reads as the engine's contract to a chain
author. Same seam as DOC-HARNESS-STATE-OWNERSHIP and
CHAIN-AUTHORING-RUNTIME-NAME-AGREEMENT, which
`tests/retired-narration.test.ts` already holds to their writers by reading
`src/`; an agreement pin driving `worktreesBase` against both doc claims fits
beside them (engineering.md, "A seam gate reads what the real writer wrote").

Fence for such an entry: `README.md`, `docs/CHAIN-AUTHORING.md`,
`tests/retired-narration.test.ts`.
