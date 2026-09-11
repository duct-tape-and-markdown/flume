# humanOnly de-chained; `workshop` survives in PendingSchema prose

Both sites shipped: `Chain`'s header (src/Phase.ts:473-476) and
`humanOnly`'s comment (:489-494) now state the mechanism — a phase whose
input a human authors between runs, so a sibling's handoff cannot produce
it — with no phase name and no workshop layer. "Empty means every phase is
handoff-wakeable" is the true reading of the one consumer
(src/Dispatcher.ts:1829, a filter over the handoff list).

Observed while sweeping for the same residue, outside this entry's fence:
`workshop` still appears twice in src/PendingSchema.ts — :48 and the
rendered-schema example at :515, both as a parenthetical gloss on what
`parked` means ("human action required (workshop, design call)"). Weaker
than the `humanOnly` case: it illustrates a kind of human action rather
than naming a phase, and those two sites are an agreement pair that must
move together. Plan's call whether that clears the same bar.
