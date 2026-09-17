# The job cut left a claim on the previous note too

Two edits outside the assigned file, both the same falsified claim:
`docs/MIGRATING-0.16.md`'s forward pointer said 0.17's "one break is on
disk rather than in the API" (already wrong before this entry — § 5 is an
API break), and 0.17 § 1 still named "a job dock" as an affected shape.
Both now state the condition rather than a count.

Observation for the sweep: nothing pins a migration note's *body*. The
three pins over `docs/MIGRATING-*.md` (tests/harnessPackaging.test.ts)
read linkage from README/CHANGELOG, series coverage against the
changelog's `### Breaking` headings, and the previous-note claim — all
structure. A note's before/after shapes, exit codes and symbol names are
prose only, so a page can keep describing a cut surface while every pin
stays green; that is how 0.16's pointer survived. The `docs/` carve-out in
`engineering.md` (*Narration is the ladder's bottom rung*) says a page
stating what a shipped interface does may be pinned against that
interface. A note is a dated record, so maybe it should not be — but the
forward pointer is a live claim about an unreleased page, and that one
could be.
