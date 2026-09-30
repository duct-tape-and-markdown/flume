# The named suspect is not on the tree, and the red has no reproduction here

## The suspect is refuted
`isDirectoryOrAbsent` (`src/fsProbe.ts`) namespaces every rung of its descent
itself (`statLoud(toNamespacedPath(path))`), so `isDirectoryOrAbsentUnder`'s
intermediate paths are folded, not "the unfolded half".
`tests/namespacedFsPaths.test.ts` (25 green) scans `src/` and `harness/`
tree-wide and reds any fs call on an unfolded path: none exists for depth to
break.

Loud-or-nothing is held too: `readQueueOnDisk` returns `null` only on a
descent-proven absence and throws otherwise, and `readPending` mapping `null`
to `[]` is right - an absent queue is nothing pending.

## Bisect, off the CI API
Last green run 36178660396 (`76262932`); first red 36181632876 (`55020947`).
Two code commits in it: `99ed4a72` (harness/ and tests only, cannot reach
the dispatcher) and `a73970d4` (`checkoutAddress`; a tick's branch and entry
claim keyed on the checkout). `a73970d4` is also what reds the
`checkoutAddress` case owned by
CHECKOUTADDRESS-REPORTS-ITS-COMMON-DIR-IN-THE-HOSTS-ALPHABET; the two may be
one defect, so order them. That run's logs have expired.

## Controls, measured on run 36745870387
`RELOC-A`, the shallow relocated-dock twin, passes. So does "a fanout entry's
worktree sits directly under a relocated base". `beforeEach` mints a fresh
fixture per test, so the seven other windows reds in this file cannot cascade
in. Depth on win32 is the sole variable - and the audit found nothing depth
breaks: folded and clean are the queue read, the descent, `Baton`,
`stateRootAccess`, `EntryClaimStore`, the sweep base, the worktree stamp and
`commitPendingUpdate`, and no process is spawned with a cwd under the state
root (the one win32 limit `\\?\` cannot reach).

## To proceed
A fix from here aims at a described symptom, not a reproduced one
(`engineering.md`, *A fix ships the test that would have caught it*). Needs a
win32 host, or diagnostics landed on the windows lane first.
