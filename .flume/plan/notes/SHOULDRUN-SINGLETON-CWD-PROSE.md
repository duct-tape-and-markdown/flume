# The new pin constrains how CLEAN-EXIT-TAXONOMY may edit the same section

The decline bullet list in `docs/CHAIN-AUTHORING.md` now carries a pin that
asserts **exactly one** bullet mentions both "singleton" and "fanout" — the
split has one home, and two bullets restating it is the drift the pin exists
to catch. To satisfy it I also dropped the per-tick/per-entry cardinality
from the "Synchronous, and cheap by contract" bullet; it is not lost, it moved
into the new concurrency bullet.

CLEAN-EXIT-TAXONOMY (parked) edits the last bullet of that same list — the one
still saying "a voluntary bail (the agent ran and refused)" where `spec/loop.md`
says `clean-exit`. That edit is compatible as long as it does not reintroduce
the word pair into a second bullet. Worth a line in its entry when it unparks.

Also noted, not filed: `src/Dispatcher.ts` explains the same cwd split in
prose at both consult sites (~:1840, ~:3216). Three prose copies of one
mechanism now, all true — a candidate for the expired-narration lens once
`TickContext.cwd`'s doc comment is the obvious home.
