# The scan's remaining hardcode is its file glob, and widening it is free today

The cast *target* is now generalized: the scan reads each file's `src/`/`harness/`
imports and flags `as unknown as <imported name>`, so no type is named in the test.

Still literal is the **domain** — `tests/harness*.test.ts` (stubRunner.test.ts:47).
The rest of `tests/` is a stand-in surface too.

Measured here: every `as unknown as` outside that glob casts *outward* and would
not flag — Dispatcher.test.ts:2961 (private-method shape), cliHelp.test.ts:201
(local generic `T`), Prompt.test.ts:458/470/547 (node types), git.test.ts:54/60.
So widening to all of `tests/**` is green as written today, costing a doc edit.
Out of this entry's scope (the `per` is the cast target, not the domain), so I
did not widen it silently.

One consequence if plan widens it: `tests/helpers/stubRunner.ts` quotes
`as unknown as Runner` in prose (:7) and imports `Runner` — a prose hit reading
as a violation. The scan strips no comments; a widening needs that line reworded
or comment-stripping added first.
