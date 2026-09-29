# `spec/loop.md`, *Tip verify* still scopes the claim refusal to "the wave"

The shipped engine now asks `liveForeignClaimPid` before **both** legs' picks.
A-SINGLETON-PICK-REFUSES-A-LIVE-FOREIGN-TIP-CLAIM landed the singleton's
check at the wave's spelling and the wave's point (inside the ship lock, ahead
of `checkpointBystanderState`) and widened the three doc comments that were
scoped to the wave — `liveForeignClaimPid`'s own header (`src/tipVerify.ts`),
`MergeOutcome`'s `tip-moved` bullet (`src/tickVerdict.ts`), and
`DispatcherOptions.ownTipClaimPid` (`src/Dispatcher.ts`).

The spec section the entry was cut against still reads as the narrower of the
two truths:

- `spec/loop.md:428` — "the **wave** asks one question: does a live foreign
  claim exist?"
- `spec/loop.md:440` — "the **wave** refuses exactly as before: `tipMoved`,
  remaining entries stay pending".

Both sentences are now true of the singleton leg as well. What made the entry
a defect rather than a feature was that the engine's own `TickVerdict.tipMoved`
hover already promised the wider reading — "before every harness-driven commit"
— on the package's `.d.ts`, so the narrow sentences are the ones out of step.

**Why this is a question and not an entry.** `spec/` is the human's
maintenance surface and no autonomous phase may write it
(`.claude/rules/spec-plan-build.md`). There is no fork to decide and nothing
is blocked on it — the tree and the shipped hover text already state the wide
reading. The ask is one interactive edit under human direction.

**Proposed wording**, if the ruling is simply to widen: replace "the wave" with
"the tick" at both sites, since the subject is now every harness-driven commit
under either leg, and the bullet's own list (`tipMoved`, remaining entries stay
pending) reads unchanged for a singleton that carries at most one entry.

Raised from the build note of A-SINGLETON-PICK-REFUSES-A-LIVE-FOREIGN-TIP-CLAIM,
which flagged the sync as an interactive session's. Verified on the tree this
tick.
