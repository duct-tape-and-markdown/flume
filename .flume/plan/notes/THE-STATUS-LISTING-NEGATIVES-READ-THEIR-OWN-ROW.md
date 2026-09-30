# The supervisor-liveness negatives now read their row; one sibling left standing

All seven named negatives in `describe("flume status — supervisor liveness")`
now read a `supervisorRows(out)` block — the lines starting `supervisor pid`
or `loop.pid present,` — rather than `r.out`. The helper follows the three
row-readers this file already carries (`pendingRows`, `claimRow`,
`spendLines`), so the idiom is one, not four.

Non-vacuity proved by mutation on the tree, not by reading: printing the live
wording from the stale arm reds the stale case, and printing the row
unconditionally reds the no-pidfile case at `:1113`-`:1114`. The filter admits
exactly the rows the negatives forbid, so scoping did not turn them green.

**Left standing, deliberately:** `tests/cli.test.ts:1099`, the obstructed-root
case's `expect(r.out).not.toContain("hibernating")`. Same lens shape — a
negative over the whole rendered output — but the entry named four sites and
this was not among them, and the case has no listing row to scope to (the verb
refuses before any row prints; the claim is "no listing at all"). Its subject
is a word no fixture path can carry, so the accidental-green risk is lower
than the named four. If plan wants it, the respelling is a whole-line read of
the split output rather than a substring one, which is the only scoping an
empty listing admits. Filing it as a fourth body of the family would restart
the count for a single site; noting it here instead.
