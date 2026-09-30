# The cast/guard split is repo-wide; this entry closed one module of it

Shipped: `thrownMessage` in `src/priorAttempts.ts`, both catches folded
through it, `Error`-path strings byte-identical.

The wider finding the acceptance deferred, measured on this tree:
`grep -rc 'as Error)\.message' src/ harness/` = **31** sites in 15 modules;
`instanceof Error ?` = **30**. The tree is split down the middle on how it
reads a `catch` binding, and every cast carries the same two outcomes this
entry removed here: `undefined` printed for a thrown non-`Error`, a
`TypeError` raised inside the catch for a thrown `null`.

Densest: `worktrees.ts` 7, `friction.ts` 6, `singletonTick.ts` 4,
`waveTick.ts` 3; `harness/` carries 2 (`vitestRunner.ts`, `planState.ts`).

Two things to weigh before filing:

1. **One home, not fifteen.** A module-private helper per module does not
   generalize — fifteen copies of a one-line guard is the
   helper-spelled-three-ways shape `engineering.md`, *A module is one job*
   names. The fix is one cross-module home, exported, with every cast
   rewritten to it; that export earns its consumer fifteen times over.
2. **Reachability differs by site.** Here both throwers were `node:fs` and
   `promisify(execFile)`, so nothing fired and the entry rightly claimed no
   property. Elsewhere may differ: `budgetHook.ts:360` and
   `harness/planState.ts:379` fold `JSON.parse` catches — `SyntaxError` is
   still an `Error`, but a hook or runner boundary awaiting chain-author
   code can receive a thrown string. A site where a non-`Error` is
   constructible is a `tests[]` line, not a bare shape fix, and is worth
   separating from the rest.

Suggested: one entry, one cross-module home, `files` naming all 15 modules;
a second entry only if a reachable site is found.
