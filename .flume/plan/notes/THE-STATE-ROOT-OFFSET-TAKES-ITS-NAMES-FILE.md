# The offset moved; two predicted cite sites had nothing to move

`computeStateRootRel` now lives in `src/paths.ts`, beside the `escapesRoot`
and `gitPath` it is built from. Three things the next plan tick may want:

- The entry predicted cite edits in `src/Gate.ts` and `src/tickAttempt.ts`.
  Both cite the identifier bare, with no path pair, so neither was stranded
  and neither was touched. The stranded set was four pairs (`src/flumeApi.ts`
  x2, `src/Phase.ts`, `src/pendingLedger.ts`), three in `harness/` and
  `tests/`, plus eight import specifiers.

- Side effect worth knowing: `src/flumeApi.ts` no longer imports
  `src/Dispatcher.ts` at all. The chainLoad cycle `buildFlumeApi`'s doc
  describes is untouched, but the api module is one import edge lighter.

- The moved unit test used the dispatcher fixture's `fx.repo` only as a root
  prefix. It is pure path arithmetic, so in `tests/paths.test.ts` it runs
  against a plain `resolve()`d root and touches no disk; the describe that
  left `tests/Dispatcher.test.ts` never spun a dispatcher.
