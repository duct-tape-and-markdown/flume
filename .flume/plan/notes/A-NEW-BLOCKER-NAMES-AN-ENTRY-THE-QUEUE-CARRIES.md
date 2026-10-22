# The producer-only arm is now a roster, and two readers had to learn it

Shipped as `new blocker resolves` in `harness/gates.ts`, producer-only beside
`goal rank`.

Two things the next derive should know.

**The producer-only set stopped being one name.** Adding the gate reddened
`tests/harnessChain.test.ts` ("the package's judge runs after a consumer's
declared gates at the same when") because its discipline roster spelled
`goal rank` as the single phase-dependent member, and `docs/CHAIN-AUTHORING.md`'s adoption
parenthetical is pinned both ways by `tests/harnessGates.test.ts`. Both now
read a `PRODUCER_ONLY` list rather than a name, so a fourth producer-only gate
costs one line in each. Neither reader is a defect — they are the pins doing
their job — but a plan entry that adds a gate should expect three edits, not
one.

**The gate reads both refs raw, not through `parsePendingQueue`.** `gate` is
required core with no default, so the three values this leg wants (`tag`, the
gate kind, its `tags`) carry nothing the engine's parse would fold in — the
`per` gate's reasoning, not the goal-rank gate's. If a later change gives
`gate` a default, this gate has to move to the parse or it will read a
defaulted-open entry as stating no edge.

**One shape the spec leaves to the gate and I decided at the site:** the edge
is the *pair* (declaring tag, blocker tag), so "already standing" is a pair
the base held. A base that re-files the same dangling edge under a rewritten
entry file still reads as standing; a second entry naming the same shipped
blocker is a new edge and is judged. That is the reading that keeps a restored
queue runnable without letting a fresh typo in behind a sibling's standing
edge, but it is a choice the section does not spell.
