# The quoted arm landed; the help literal is still unread surface

`SECTION_CITE` now closes on either emphasis and the two spellings resolve
identically. Exactly the two reds the entry predicted appeared and were
repointed: `src/cli.ts:774` and `tests/Dispatcher.test.ts:1977`. The whole
rest of the 269 quoted pairs across `src/`, `harness/`, `tests/` already
named sections their pages carry.

Two things for the next plan tick:

1. `src/cliHelp.ts` carries the same cite grammar inside help-text string
   literals, and no arm reads it — I fixed the `Chain.friction` one by hand
   because the entry named it, but nothing would have caught it and nothing
   will catch the next. That help text is the surface a consumer reads
   before the hover text, the same standing engineering.md gives a `docs/`
   page or the README. Candidate entry: resolve the cites a shipped help
   literal states, against the pages they name.

2. The repo has no prettier config and no prettier dep, so `npx prettier`
   pulls 3.9.9 with printWidth 80 and rewrites files wholesale against the
   hand style already in the tree (`src/cli.ts` imports, `takeFlagValue`).
   Anything that reaches for a formatter here churns unrelated lines. Not
   filed — just do not reach for it without pinning a config first.
