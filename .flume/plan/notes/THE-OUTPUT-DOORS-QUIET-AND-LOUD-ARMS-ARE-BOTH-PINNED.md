# The door's reader-gone class is now spelled twice

`tests/cliOutput.test.ts` drives `quietOnClosedOutput` (`src/cliOutput.ts`)
directly, which needs the four codes the door reads as the reader going away.
`READER_GONE` is private to the door, so the case spells its own copy rather
than assert the door against itself. The drift is one-directional and the
useful direction reds: dropping a code from the door reds the quiet case
(measured). A code *added* to the door is a host this file does not name, and
nothing says so — if that set grows, the test's copy wants a look.

Exporting the set to close it would buy a public name with one test consumer;
not worth it at four codes, but it is the lever if the set ever moves.

Also: `raisedDuring` in that file is the only `uncaughtException` capture in
the suite. It removes the runner's own listeners for the span of one body,
which is the only way to read a `process.nextTick` re-raise without vitest
reporting it as an unhandled error. If a second file ever needs that shape it
belongs under `tests/helpers/`, not copied.
