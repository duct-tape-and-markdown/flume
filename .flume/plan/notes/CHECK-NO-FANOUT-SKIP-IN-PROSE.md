# check's skip line reads "(1 entries)"

Pinning the skip clause meant reading `flume check`'s real stdout, which
prints `plan/pending.json valid (1 entries), no fanout phase declared;
fence not checked` — `src/cli.ts:555` and the fence-pass line beside it both
interpolate the count with a hard-coded plural noun. Cosmetic, on an
operator-facing verb; not correctness-adjacent, so filing it as observed
debt rather than an entry.

Both new pins sit in `tests/cliHelp.test.ts` and drive the real writer, but
the fixture they need (a fanout-less chain + a queue that declares files) is
a second hand-rolled copy of the same chain source — `tests/cli.test.ts:1541`
has the other. The repo already carries five private `makeJobRepo` copies
across test files; a shared `tests/helpers/` home for the chain-source
fixtures would retire all of them. Worth a sweep lens if another suite needs
one.
