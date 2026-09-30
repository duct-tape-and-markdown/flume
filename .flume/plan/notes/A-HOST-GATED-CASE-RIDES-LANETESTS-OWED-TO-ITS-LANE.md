# laneTests ships; nothing checks that the lane it names was declared

Two things the next plan tick should route.

**A laneTests line's lane is unverified.** `spec/harness.md`, *The judges*
says "each a declared lane and a test title", and the field now parses a
non-empty `lane` and nothing more. A typo'd or retired lane name yields a
line reported owed to a lane that does not exist, and nothing ever files or
closes it — the line passes the judge forever. The check is reachable:
`harness/chain.ts` holds `declaration.ci` where it builds `namedLinesGate`,
so the gate could refuse a lane no declared lane names. I did not build it,
because it needs a decision: a consumer with a second host but no declared
CI lane (no forge, a manual run) would have every laneTests line refused,
which may be the wrong answer. Fork: (a) refuse an undeclared lane
unconditionally, (b) refuse only when the consumer declares at least one
lane, (c) leave it unchecked and say so at the field. Entry or question,
plan's call.

**The entry-extension section does not list the field.** *The entry
extension* still rosters six fields and the risk flag; `laneTests[]` is
declared only in *The judges*. The declaration and
`docs/CHAIN-AUTHORING.md` now carry it, and the suite pins that page against the declaration — but the spec section a
consumer reads first names one field fewer than the package ships. Human's
surface, so it is stated here rather than edited.

Also: `spec/harness.md`, *The runner interface* still describes `run`'s
report as passing-only, ahead of the skipped status this entry added. The
entry's own notes flagged that; it is still true.
