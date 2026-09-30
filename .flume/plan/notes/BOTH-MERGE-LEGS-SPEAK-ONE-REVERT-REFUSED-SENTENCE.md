# The two legs now spell one sentence twice

Shipped as ruled: `SpanNarration.revertRefused` takes `refusal` alone, and
the wave's line respells to the singleton's sentence plus `; other entries
continue`. `failure` stays the recorded `StageFacts` on the carry.

Observed, not filed: the sentence is now a verbatim duplicate across two
string literals (`src/waveMerge.ts`, `src/singletonTick.ts`), differing only
in the subject before `: revert of ` and the wave's tail. That is the exact
shape `.claude/rules/engineering.md`, *A module is one job* calls a sequence
copied across legs, and `SpanNarration`'s own header still reasons the other
way — "a spelling shared across them would be a third vocabulary neither leg
speaks" — which was true of the record of functions as a whole and is no
longer true of this member. Left as debt: the refactor is behavior-free and
the entry ruled only the argument shape.

Second site of the same family, for the three-notes count: `absorbed` and
`merged` are already near-parallel between the two legs too (phase name vs
entry tag, otherwise the same words). If this family is filed, the target
shape is one composer taking subject + the shas + the leg's tail, called
from both narration blocks, rather than a shared spelling reached through
the carry — the carry must stay ignorant of the vocabulary.

Test siting: the two assertions could not go on the standing collision
fixtures, since `tests[]`/`pins[]` match on a test's full name and those
titles carry their own claims (an uncaught refusal does not crash the tick).
They landed as a new describe beside them, with the shared frame read once
and each leg's subject and tail asserted per case. The pin is green on the
base tree; the wave's line reds there, on the missing `back to <landedOn8>`.
