# `pins[]` does not dodge the integration-lane wall

Shipped, with one relocation plan should rule on.

The entry's `pins[]` line could not live in the file `files.edit` named.
`vitestOnCode` passes `[...named, ...pinned]` to `judgeVitestReport`
(`.flume/chain.ts`), which reads the **fast**-lane report — so a *pin* whose
only test sits in `tests/*.integration.test.ts` reverts with "N of N named
behavior(s) have no passing test", exactly as a `tests[]` line does. Moving a
line to `pins[]` only dodges red-on-base, never the lane.

That corrects `open-questions.md`, *Two shapes of `tests[]` line the vitest
gate cannot judge* — which records "moved the parked entry's line to `pins[]`"
as a remedy. It is not one. The recommended prose clause should say fast-lane
for both fields.

So the clean-exit case moved to `tests/cli.test.ts` (fast lane), retitled with
the pin line and anchored on a planted stale claim; `--max 0` loads no chain
and runs no tick, so the lane stays fast. The integration suite keeps its
other six sites, all now derived through a local `headClaimPath`
(`currentRefPath` + `tipClaimPath`), and the detached-HEAD test derives
before detaching.
