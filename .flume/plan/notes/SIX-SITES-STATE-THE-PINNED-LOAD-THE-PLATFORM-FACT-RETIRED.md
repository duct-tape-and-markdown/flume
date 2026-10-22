# The two readings disagree by what was measured, not by loader

Six sites restated. The Dispatcher cite is now backticked and spelled
`tests/loop-process-boundary.integration.test.ts`, so the repo citation pin
reaches it — verified it reds on a dangling spelling.

**The entry's premise is wrong, and so is the page.** Measured this tick on
tsx 4.21 / node 24.21, identical under vitest and under plain node:

- `tsImport` re-transforms the **entry** every call: a chain.ts broken
  between two calls throws `TransformError`.
- The **evaluation stays the first one**: rewrite a loadable chain.ts to
  another loadable one and the second call still answers the old module.
- The **dependency subgraph is not re-read**: break a module chain.ts imports
  after a clean load and the next call answers the earlier evaluation without
  throwing (broken before the first load it does throw, so it is in the graph).

So "tsImport re-reads" holds for the entry's transform only. Two corpus
sentences overstate it and are the human's to fix:

1. `.claude/rules/platform-facts.md`, *A plain `import()` is pinned;
   `tsImport` re-reads* — "and its dependency subgraph" is contradicted, and
   "sees the disk as it is now" holds only for a break in the entry itself.
2. `spec/chain.md`, *Chain resolution is per-tick, and the tick is a fresh
   process* — "re-reads `chain.ts` and its dependency graph on every call —
   and the supervisor's mount-dead re-read leans on that". The lean is real
   but narrower: a live supervisor's re-read sees chain.ts gone or no longer
   compiling, and **misses a break in anything chain.ts imports**. An
   operational hole, not just prose — worth an entry once the page is settled.

Acceptance deviation, deliberate: nowhere did I write that an in-process
re-resolution does *not* return a pinned evaluation, because for a
still-compiling chain.ts it does. Each site states the qualified shape;
`loadChainModule` is its one home and the four cases point there.
