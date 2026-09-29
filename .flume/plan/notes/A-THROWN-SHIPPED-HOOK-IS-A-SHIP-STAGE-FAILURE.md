# The refusal verdict is a second buildTickVerdict caller a new fact must reach

Observed while adding `shipFailures`: the field reached
`closeWaveMerge` -> `waveTick` -> `Dispatcher` and the completing verdict was
green, while the *refused* verdict (`waveMergeError`, `src/waveMerge.ts`) still
omitted it. The only thing that caught it was the one-wave-two-producers
agreement pin in `tests/Dispatcher.test.ts`. That pin now covers six
conditional facts, but it only bites because the fixture wave is shaped to
populate each one — a new stage record that no entry in that wave produces
would pass it vacuously. Worth plan knowing: a future stage/fact entry should
name "populate it in the two-producer wave" as work, not assume the pin holds.

Second: `stageWord` in `tests/docComments.test.ts` needed a fence arm for
`ship` (`ship(?![a-z])`), because the tree spells `shipped`/`shipping`/`ships`
everywhere and a bare `\bship` reads those as the roster naming its stage. The
roster scan now has two members with spelling arms (`provision`, `ship`). A
third would suggest the arm belongs in the engine beside `FAILURE_STAGES`
rather than in the scan — debt, not correctness-adjacent today.

Third, a shape note: `LIFTS_ON_A_MOVED_TIP` is now four of six members and the
excluded two each carry a sentence explaining why. The set is still the right
spelling (a membership set, not an inequality), but if a seventh stage lands
the doc comment is where the cost shows.
