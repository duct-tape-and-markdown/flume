# The fold for a whole path is toNamespacedPath alone

Two things for plan out of scanning `src/`.

1. **A platform fact with no home.** On win32 `path.toNamespacedPath`
resolves what it is handed before prefixing, so where a path arrives whole
(a caller's dir, a resolved manifest) `toNamespacedPath(x)` is the entire
fold, and `namespacedJoin(x)` only adds a lexical `..` resolution that is
wrong across a symlink. The 23 already-correct sites in `src/git.ts`,
`src/priorAttempts.ts` and `src/worktrees.ts` are spelled that way; this
tick spelled the 11 bare ones to match and widened the scan to accept it.
`platform-facts.md`, *Windows MAX_PATH*, says only "reach for
`namespacedJoin` instead of a bare `join`" — the scan now reads that
distinction more precisely than the page states it. The page is the
human's.

2. **Debt.** `tests/Baton.test.ts`'s MAX_PATH describe is now subsumed: its
per-module scan of `src/Baton.ts` is a strict subset of the `src/` scan in
`tests/namespacedFsPaths.test.ts`. Only its "imports namespacedJoin from
./paths.js" case says something the tree-wide scan does not.
