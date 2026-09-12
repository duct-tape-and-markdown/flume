# The vocabulary class survives in src/ doc comments

Shipped as written: the rendered core hints carry no phase name, plan-lane
artifact or stack noun, and the three pins name the class (a regex
alternation), not one literal.

Two edits beyond the entry's predicted files, same file, same class:
`dependsOnForks`'s field doc said "Open-question fork slugs" two lines above
"The slug is opaque to the runtime" — a contradiction, not just a vocabulary
slip — and `isPickableNow`'s doc glossed the injected predicate as "is this
open-question fork resolved?".

Left unfiled, because neither renders into a prompt and the sweep may cut it
differently: `src/Dispatcher.ts:1163` carries that same gloss verbatim
(`engineering.md`, *The fix lands at the mechanism*), and `src/Phase.ts:342`
illustrates `entryChannelPaths` with `.flume/plan/open-questions.md` as its
only example. Both are doc comments an engine consumer reads on hover.
