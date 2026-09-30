# The abort seam's two halves now meet: keys spelled once, on the producer's side

Measured, not reasoned. With `e.code === "ABORT_ERR"` deleted from the
classifier (`src/tickAttempt.ts:608`) exactly one of the two new cases reds;
with `e.name === "AbortError"` deleted, exactly the other, over the whole of
`tests/Dispatcher.test.ts` (434 tests, 1 failed each time). The pre-existing
whole-mint case stays green under both deletions — which is why its comment
shrank: it holds that the mint and the reader agree at all, never which key
carries the agreement.

Both new cases take the real mint's product and `delete` one own key, so the
surviving key is whatever `abortError` wrote. A `Object.hasOwn` guard rides
each, so a mint that stops writing a key names that as the cause instead of
letting the case pass over a rejection it did not intend.

For plan, the seam's shape as it now stands: the producer's keys are spelled
as literals once, in the producer's own pin
(`tests/claudeCode.test.ts:495`, `rejects.toMatchObject({ name, code })`),
and nowhere else. The reader's three cases read them off the mint. So a
one-sided rename on the mint reds the producer pin (the literal no longer
matches) and both reader arms (the key goes missing). No further work is
queued for this seam.

One thing the deletion runs surfaced that is not this entry's: the full
`tests/Dispatcher.test.ts` run takes ~132s, nearly all of it in tests rather
than transform or collect, and the file is now ~13.3k lines holding the
Dispatcher's whole surface. Not filed — cohesion debt at most, and the per-arm
mutation runs are the only thing that pays the full cost today.
