# `humanOnly`'s doc still names a phase no shipped chain declares

Both README sites now read `plan → build`, driven against
`examples/cascade-chain.ts`'s `phases` array through the phase declarations it
resolves to, so a later phase change turns the pin red.

Residue the sweep may want, outside this entry's fence: `src/Phase.ts:474`
glosses `Chain.humanOnly` as "The canonical example is `spec`, which derives
from human-authored workshop content", and `src/Phase.ts:459` repeats "(e.g.
spec from a workshop session)". After 58092d0 cut the spec phase, cascade
ships `humanOnly: []` — so the engine's only worked illustration of the field
points at a phase no example declares. Same shape as this entry (narration
outliving the example it cites), one layer down.

`docs/CASCADE-DRY-RUN.md` also mentions workshop; that one reads as historical
material and I left it.
