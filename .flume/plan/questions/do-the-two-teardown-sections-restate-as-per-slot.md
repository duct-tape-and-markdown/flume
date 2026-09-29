# Do the two teardown sections restate as per-slot?

Two sections of `spec/worktrees.md` state a shape 5e2e062e retired — *Every
`.git/worktrees` mutation is serialized; the agent fanout is not* and *Teardown
harvest — the delivery guarantee*. The serialization the first exists to state
still holds, and so does the guarantee the second states: every create and every
remove rides one queue (`provisionTail`, `src/waveTick.ts:272`), and the harvest
still runs before removal while the worktree path exists. What is wrong is the
*when* — both pages say the walk happens at wave end, and it now happens once
per slot as that slot's own attempt ends (`settleSlot`, `src/waveTick.ts:496`).
Spec is the human's surface and sits outside build's fence, so no autonomous
phase can carry the restatement; this is the whole of why it is a question
rather than an entry.

The ruling that moved it is `.flume/inbox/2026-09-29-a-claim-ends-with-its-
attempt-ruled.md` (landed 45073e80): *the slot is the attempt*, and "the
branch-collision hazard the single wave-end site guarded goes with the per-wave
teardown that created it." That ruling restated `spec/pending.md`'s claims
section and left this one alone — the gap is a ruling's other half, not a drift.

## What no longer holds, verified on disk this tick

1. **The walk** (`spec/worktrees.md:155`-`:157`). "Teardown is the same
   sequential walk … Teardown is off the critical path, so a plain serial walk
   beats interleaving the git-mutating step out alone." Teardown is now one step
   per slot, taken as that slot's own attempt ends (`settleSlot`,
   `src/waveTick.ts:496`), and it *is* on the settling slot's critical path: a
   refill's `git worktree add` queues behind the teardown ahead of it, on the
   same `provisionTail`. The shipped warrant is the inverse of the stated one —
   teardown rides the queue *because* `remove` mutates metadata a sibling's
   `add` is validating, not because it is free to be serial.

2. **The index-alignment** (`:162`). "with `provisioned` and `worktrees` kept
   index-aligned for everything downstream." There is no `worktrees` list. Each
   slot holds the one worktree it created; `provisioned` survives as the wave's
   own list of entries it provisioned for, aligned with nothing.

3. **The harvest's timing** (`:323`, *Teardown harvest — the delivery
   guarantee*). "At wave end, for each worktree, **before removal**
   (`harvestFriction`)". The harvest is now inside the settling slot's own
   teardown (`teardownWorktreeInstance`, `src/worktrees.ts`, called from
   `settleSlot`), so it runs per slot rather than once for the wave. This is
   the section's *good* news and worth saying: a note from a slot that parked
   reaches the primary channel while its siblings still run, rather than at a
   wave end hours later — which is the same economics the ruling settled for
   the claim.

4. **A silence the change narrowed.** A wave that leaves by throwing now leaves
   standing only the worktrees and claims of slots that had not settled when the
   wall went up; slots that settled earlier are already torn down and unclaimed.
   Before, a wall stranded every one of them. No spec sentence states either
   shape — the section is silent, and `src/waveTick.ts:490` is the only place
   the narrowing is declared.

## The fork

Deltas 1-3 are one restatement and I see no fork in them: the walk bullet takes
the per-slot teardown on the same queue with its real warrant, the
index-alignment clause goes (the isolation sentence it rides stays), and the
harvest's "At wave end" becomes "as each worktree's own attempt ends". The fork
is delta 4 alone — whether the residue gets said, and where:

- **(1) Leave (4) silent.** Restate 1-3 and stop. Cheapest, and it closes
  everything that is actually wrong. Cost: what a wall leaves standing remains a
  fact only a doc comment carries, so the next reader of the section cannot tell
  whether a wall strands one worktree or all of them.
- **(2) State the residue in the serialization section.** (1) plus one sentence,
  which makes the narrowing a spec claim the sweep can read `src/waveTick.ts:490`
  against. Cost: one more sentence on a section already at four bullets, and the
  residue arguably belongs beside the refusal-residue passage `spec/loop.md`
  already carries (the "what survives a refusal on disk" paragraph), not here.
- **(3) State the residue in `spec/loop.md`.** Puts each fact on the page that
  owns it. Cost: two files for one ruling's tail.

Leaning (2): the residue is a property of the wave's teardown, which is the
serialization section's subject, and `spec/loop.md`'s refusal-residue paragraph
is about what a *revert* leaves, not what a thrown wave abandons. But which page
owns "what a wall leaves standing" is yours — the two pages already split wave
mechanics from run mechanics and I would rather not guess where the seam falls.

Whatever the answer, the recommended sentences name behavior only: the queue,
the slot, the residue — never `provisionTail`, `settleSlot`, or a `src/` path
(`.claude/rules/spec-writing.md`).
