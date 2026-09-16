# The lead-in-restates-the-walk family has more members than this one

The defect shape here — a paragraph naming a set three lines above the
bullets that walk it, where the standing pin's reader only reaches the
bullet leads — is the third instance in `docs/CHAIN-AUTHORING.md` after
the three counts. The fix widened the reader to every backticked mention
in the section, so the pin now reds on a re-listing anywhere in it.

The other walked-set pins on the same page still read bullet leads alone:
the supervisor-policy walk and the `GateContext` walk. Both sections open
with prose, and neither pin can see a set restated there. Nothing restates
one today (checked this tick), so there is no entry to file — but the
reader shape is a per-section copy, and a sweep of *A module is one job*
over `tests/examples.test.ts` would find three walks spelling the same
read three ways. One `mentionsIn` helper shared across them is the target
shape if plan wants it.

`docs/MIGRATING-0.16.md` still names the three operations; it declares
itself a dated record at its own site, so it stays unpinned.
