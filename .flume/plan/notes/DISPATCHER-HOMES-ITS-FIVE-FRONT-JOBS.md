# One bridge line survives the split, and it needs a hand outside the fence

`.flume/chain.ts:14` deep-imports `type ChainFactory` from
`../src/Dispatcher.ts`. `.flume/**` is outside every autonomous phase's
writable paths, so no tick can respell it, and tsconfig includes the file —
dropping the name reds tsc. So `src/Dispatcher.ts` keeps one declared
`export type { ChainFactory } from "./chainLoad.js"`, cited with its retiring
trigger. **An interactive session should repoint `.flume/chain.ts` at
`../src/index.ts`** — what `harnessInit`'s own template emits, and what
`@dtmd/flume` resolves to — and delete the bridge in that commit.

Stale citations seen while re-homing, all pre-existing, none touched:
`src/paths.ts:431` says `priorAttemptsDir` is re-exported from
`src/Dispatcher.ts` (it is not); `tests/cli.test.ts` homes `frictionCountLine`
and "the supervisor's per-iteration check" there (they are `src/friction.ts`,
`src/loopSupervisor.ts`); `tests/chain.test.ts:61`'s title claims it exports
`slugify` and `priorAttemptPath`. The citation pin reads tokens, never
meaning, so all stay green — a lens the sweep has no arm for.
