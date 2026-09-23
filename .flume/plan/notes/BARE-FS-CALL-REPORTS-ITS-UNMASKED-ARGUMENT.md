# The scan's rendering test took the entry's title, and the old one is gone

`tests/namespacedFsPaths.test.ts` had one case over `BARE_JOIN_SOURCE`, and
with the fixture now carrying a string literal that case *is* the entry's
`tests[]` claim — a second `it` over the same fixture would have asserted the
identical equality. So the case was retitled rather than duplicated: the title
"the namespaced-fs scan names the call and the uncomposed argument of a bare
join" no longer exists in the suite. Nothing in `.flume/` cited it; a later
entry naming it in `pins[]` would come back unnamed.

Two things the sweep may want, neither filed:

- The other renderings read fields that cannot differ between the two faces —
  `describeJsForm`/`describeUncalled` print a callee or an import name, which
  are identifiers, so `maskNonCode` leaves them intact. The unmasked slice is
  load-bearing for `BareFsCall.argument` alone.
- The full suite timed out one worker's `onTaskUpdate` RPC on the first run
  here (62 of 63 files reported, 0 failures); a second run reported 63 files,
  1677 passed, 0 failed. Load flake under a 260s suite, not a verdict — worth
  knowing if a judge or CI lane reports a missing file rather than a red one.
