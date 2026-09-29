# The offered triple wants a name, and `runFanoutEntry` re-splays it

Shipped: `livePriorAttempts` joins `livePickable`/`liveClaimedTags`, the
`offered` bundle carries all three, and `refillRead` publishes the records
it already read for its own re-selection. Test in the live-queue refill
block; red on the base (the refilled slot's map was empty).

Two shape observations, neither correctness-adjacent, both filed here
rather than guessed at:

1. `offered` is now a three-field anonymous object literal spelled at its
   construction site (`src/waveTick.ts`, `fillSlots`) and again in
   `runSlot`'s parameter type. It is the vocabulary "the facts the
   selection that pulled this slot's entry was taken over" — a named type
   beside `BatchSelection` would stop the next fact added to a
   `TickContext` from having to be threaded through two literals
   (`.claude/rules/engineering.md`, *A module is one job*: a vocabulary
   spelled twice by two sites has one home).

2. `runSlot` immediately re-splays the bundle into three positional
   arguments of `runFanoutEntry` (`pickable`, `claimed`, `priorAttempts`,
   positions 8-10 of ten). That function's signature is the widest in the
   file and every argument past `chain` is positional. Passing the bundle
   whole would shrink it and make the next addition a field rather than a
   position.

Neither can change behavior today, so both are debt, not entries — but
they are the same family (the triple has no name), so one entry naming
the target shape would cover both if a third addition lands on this seam.
