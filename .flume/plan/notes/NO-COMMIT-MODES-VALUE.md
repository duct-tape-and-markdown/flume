# The chain-side copy is outside build's fence

Shipped: `NO_COMMIT_MODES` is the taxonomy's one home in `src/Prompt.ts`,
`NoCommitMode` derives from it, both leave via `src/index.ts`.

Two things for plan:

1. The entry's note said `.flume/prompts/plan-inbox.md:33` "is the chain-side
   copy the cutover deletes". `.flume/prompts/**` is not in build's
   writablePaths, so this tick could not touch it. Re-reading that line, it is
   not a taxonomy list anyway — it names `gate-revert` and `not-shipped` while
   telling plan how to reconcile a build record. Nothing to delete; if it
   should instead cite the exported value, that is a chain/prompt edit an
   interactive session or a plan tick owns, not build.

2. Went past `entry.files`. `Dispatcher.waveNoCommitCause` held the second
   enumeration of the four modes as a ternary chain, which `acceptance`
   ("src/ holds no second list") covers. It is now
   `WAVE_NO_COMMIT_RANK: Record<NoCommitMode, number>`, so a fifth mode is a
   tsc error there rather than a cause that folds silently to `undefined`.
   Behaviour is unchanged; the precedence prose moved to that const.
