# Argv-keyed mocks are a vacuity class the title lens misses

Both retitles landed; the locale case now pins the injection via a
mock-side `injectedRejections` log (tests/git.test.ts, top-of-file
`node:child_process` factory) rather than re-deriving the mock's own
match condition from `execArgsLog`.

Worth a lens: this suite's `node:child_process` mock keys injections on
*argv positions* (`gitArgs[3] === "refs/heads/..."`). Any such mock is
vacuous-by-drift — when the callee's argv changes the mock silently
stops firing, the real tool runs, and a case asserting only the happy
verdict stays green over an unexercised subject. `deleteBranch`'s was
the live instance; the `branch -D` arm of that same predicate
(`gitArgs[1] === "-D"`) is reached by no case at all, so it is dead
injection plumbing a sweep may want to read. The general shape — "a test
double whose trigger is a positional match carries a pin that it fired"
— is stronger than this per-case fix and may deserve filing across the
suites that mock spawn/execFile.
