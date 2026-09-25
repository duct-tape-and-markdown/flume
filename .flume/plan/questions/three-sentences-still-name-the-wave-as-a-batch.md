# Three sentences outside the rolling-wave ruling still describe a batch wave — do they restate, or does one of them constrain it?

`spec/worktrees.md`'s opening now rules that a wave "carries each entry's
commits back onto the trunk **as its agent finishes**, under the ship lock, from
the tip as it then stands", and that "a slot freed that way pulls the next
pickable entry disjoint from everything still in flight". Three sentences
elsewhere in the corpus describe the shape that ruling replaced. None of them
was touched by da4fd71f, and each reads as current where it sits:

1. `spec/worktrees.md`, *Fanout is the engine's declared navigation carve-out*:
   "The per-entry commits are `cherry-pick`ed onto that same tip, in batch
   order" — "that same tip" being the tip the tick started on, named two
   bullets above as the worktree's `fromRef`.
2. `spec/loop.md`, *The engine records, never navigates*: "A fanout wave's
   per-entry worktree commits are carried onto the tip the tick started on, in
   order, with `cherry-pick --abort` on conflict."
3. `spec/loop.md`, *Declining a tick before the invocation*: a fanout
   decline "runs *after* the whole batch has been provisioned (`createWorktree`, serially) and after every `setupWorktree`
   hook has completed" — a cost statement that stops holding for an entry
   pulled into a slot freed mid-wave.

## What plan did, and why this is yours

Both halves of the ruling are filed as entries against the opening section
(`THE-WAVE-MERGES-EACH-ENTRY-AS-ITS-AGENT-FINISHES`, and
`THE-FREED-SLOT-PULLS-THE-NEXT-DISJOINT-ENTRY` chained behind it). Neither is
parked: the behavior is ratified and unambiguous, and the engine already
states the governing fact for a moved tip in a fourth place — `spec/loop.md`,
*Tip verify — one writer per branch, absorption at the merge*: "The wave cherry-picks onto whatever tip is current".

So this is not a fork plan needs answered to derive. It is that `spec/` is
one corpus stating present truth, three of its sentences now state the
previous one, and plan cannot edit `spec/`. The read plan acted on:

- (1) and (2) are about **which refs the engine touches**, not about a base
  sha; the start-tip phrasing is incidental to both and the ruling governs.
  The proposed edit is a phrase each: the picks land on the trunk as it then
  stands, one at a time under the ship lock.
- (3) is a **cost** statement, true of the wave's initial fill and false of a
  refill. The proposed edit names the fill it describes.

If instead any of the three is meant to constrain the rolling wave — if a
refilled entry's worktree must be cut from the tip the tick started on rather
than the tip it is pulled at, say — that is a real mechanic the entries do not
carry, and it wants a sentence in the ruling itself.
