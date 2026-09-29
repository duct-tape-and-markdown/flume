# The retired-claim delta now draws its paths past its own cursor

Fixed as filed: `retiredLines` (`harness/sweepWindow.ts`) took the frontier's
commit list and now scans `commitsPast(searched)` itself, so the path union and
the diff come off one range.

Two things the next plan tick may want.

**`retiredThrough` is never checked against the tree.** `cursorWindow` runs
`resolvesInTree` on `sweptThrough` alone. A `retiredThrough` naming no commit
here now throws out of the new `commitsPast` (before, out of `deletedLines`),
and `bounded` renders the refusal under the name `sweptThrough` with a repair
pointing at that field — so the tick is sent to fix the cursor that was
correct. The sibling `unresolvedCursor` leg spells this properly for
`sweptThrough`; the retired cursor has no equivalent. Not filed here: it wants
a decision on whether the second cursor gets its own refusal or whether
`cursorWindow` grows a notion of a slice's extra cursors, which its header
deliberately excludes (`A module is one job`).

**Second `git log` per sweep render.** The window now scans two ranges. Both
are cheap next to the per-path diffs `deletedLines` already runs, and the
retired range is the shorter one on any rotation that has been searched — but
the two scans are not shared, and `commitsPast` is the one call a future
sharing would key on.

Test added beside the cursor's own cases; reds on the pre-fix tree as
`(none)`, which is the measured symptom the entry cites.
