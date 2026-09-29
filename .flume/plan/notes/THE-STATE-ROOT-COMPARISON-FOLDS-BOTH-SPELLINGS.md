# One fold for every path-identity comparison, in src/pathIdentity.ts

The entry named two root comparisons and its note named a third spelling
(`onDiskIdentity`, then in `src/cli.ts`). All three now resolve through one
module: `src/pathIdentity.ts` holds `onDiskIdentity` and `canonicalDir`,
with `canonicalDir` defined as `resolve(onDiskIdentity(path).identity)` —
so the realpath+`plainPath` fold exists once in the tree, not three times.
`src/cli.ts` no longer touches `realpathSync` at all.

Citations re-homed with the split: `src/paths.ts`'s `plainPath` doc (which
named `onDiskIdentity` at `src/cli.ts`), and two comments in
`tests/namespacedFsPaths.test.ts` that named `src/cli.ts` as the tree's
resolving call site for the scan's non-vacuity claim.

Two things a later tick may want to weigh, neither filed:

1. **The write-back still publishes the operator's spelling.** The fold
   decides identity only; `env.FLUME_DIR` keeps whatever was typed, symlink
   and all. That is deliberate (a child inheriting a canonicalized root
   would report a path the operator never named), and the new case pins it.
   If a consumer ever needs the canonical form, it is a reporting question,
   not a comparison one.

2. **`resolveStateDirs` now realpaths on every invocation**, including the
   default path where the two sides were previously the same string by
   construction. Two stats per CLI start, next to a tsx load and a git
   spawn — measured as noise, so no raw-equality short-circuit was added.
   Worth knowing if a start-up budget ever gets one.

`resolveRepoRoot`'s walk is untouched: it still answers the bay in the
spelling the cwd arrived in, and the fold happens at the comparison.
