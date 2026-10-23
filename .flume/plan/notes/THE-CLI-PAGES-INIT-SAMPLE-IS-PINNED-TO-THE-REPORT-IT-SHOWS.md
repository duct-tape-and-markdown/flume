# The init sample is pinned; two neighbours it uncovered

Shipped: three cases in `tests/harnessPackaging.test.ts` drive the published
`bin/flume-harness.js` over a repo with a commit, a manifest and
`pnpm-lock.yaml` (every report arm reached), then read the bin's stdout and
`docs/CLI.md`'s sample through one label parse. Both directions measured red
on the base: a label added to `harness/cli.ts` reds, a label dropped from the
page reds.

Beyond the entry, two literals in the same block:

1. `ignores +10 line(s)` was stale — `consumerIgnores` merges 12. Corrected
   and pinned against the real report (`engineering.md`, *A count is a
   meaning, never a token*). Third case, not a named line.
2. The `cursors` line shows `9f2c1ab…` where the verb prints a full 40-char
   sha. Left alone — it is illustration, not a derived literal — but a reader
   will expect an abbreviation. Human's call.

**Pre-existing red, unrelated to this entry.**
`tests/harnessRunner.test.ts`, *a listing vitest cannot produce leaves no
coverage known rather than an empty set* fails on this host: `coverage.kind`
is `known` where it expects `unknown`. Diagnosed — inside the vitest process
`vitest`'s own package directory sits on the global resolution path, so
`createRequire(join(<bare tmp dir>, "package.json")).resolve(
"vitest/package.json")` answers, while `zod` and `tsx` from the same base
give `MODULE_NOT_FOUND`. So `resolveVitest`'s unresolvable arm is unreachable
from a suite run under vitest, and that case cannot be green in-process.
Measured, vitest 2.1.9 / node 24.21, probe test since removed. The fix is
another entry's: either drive that arm at a resolver whose tool is not
vitest, or deny structurally (a `vitest` directory that is a plain file).
