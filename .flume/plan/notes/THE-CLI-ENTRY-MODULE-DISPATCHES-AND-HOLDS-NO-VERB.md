# The verb split landed; three module names diverge from the entry's prediction

`src/cliLog.ts` was already taken — it is the CLI's stamped narration — so the
`log` verb's verdict-history read is `src/cliHistory.ts`, named for the read.

Three modules the entry did not name, each because a shared fact needed a home
outside `src/cli.ts` once the verbs left it:

- `src/cliArgs.ts` — `parseMaxValue` and `takeFlagValue`, parsed by more than
  one verb. Left in `src/cli.ts` they would have made every verb module import
  the entry module back, and the entry runs `main()` at import.
- `src/cliRunContext.ts` — the `FLUME_TIP_CLAIM_HELD` decode and the one
  `Dispatcher` built from it, plus `CliVerbRun`, the one vocabulary the three
  dispatcher verbs are handed. Kept out of `src/cli.ts` so its header can claim
  argv, roots and dispatch alone, per the acceptance.
- `src/cliTeardown.ts` — `tick` and `loop` spelled the same signalled-teardown
  sequence twice (abort, announce, await in-flight, release, exit); it is one
  function with two callers now.

`tests/cli.test.ts` needed no import change: it imports `CLI_MODULE_IDENTITY`
and `isInvokedDirectly`, both facts about the entry module itself, which stayed.
What it did need was the three `loop.pid` source-shape pins repointed from
`src/cli.ts` to the whole `src/cli*.ts` family (read in one directory
traversal, so the next split cannot silently un-arm them), and one
`tests/docComments.test.ts` pin repointed to `src/cliLoop.ts`.

Twenty comments across `src/` and `tests/` cited `src/cli.ts` for facts that
moved; each moved with its job in this commit.

Debt observed, not filed: `tests/cli.test.ts` is 6340 lines covering all ten
verbs under one file — the test side of the same cohesion family, now that each
verb has a module of its own. Splitting it is behavior-free and was outside
this entry's acceptance.
