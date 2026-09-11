# The TickContext summary pin is containment, not set-equality

The Phase-table pin (`tests/retired-narration.test.ts`, "names every field
src/Phase.ts declares") compares sorted sets both ways, because a markdown
table gives one field per row. The new `TickContext` pin cannot: its restating
side is free prose, which legitimately backticks siblings (`shouldRun`,
`blockedBy`, `{{FLUME_DIR}}`) alongside the fields it teaches. So it holds one
direction only — every declared field is named. A field *removed* from
`src/Phase.ts` leaves its paragraph behind silently, and nothing fails.

Cheap close if plan wants it: give `TickContext` a field table in §1 the way
`Phase` has one, and the existing table reader + set-equality pin applies
unchanged. A doc restructure, not a test fix, so it is plan's call.

Also: the entry's notes call the summary "§2"; it is in §1 ("Declaring a
Phase"), just above the `### shouldRun` subsection. Edited there.
