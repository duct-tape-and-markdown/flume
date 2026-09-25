# `spec/worktrees.md`: the `fromRef` bullet contradicts the bullet two lines below it

`spec/worktrees.md`, *Fanout is the engine's declared navigation carve-out*,
lists the carve-out's details. `d4185664` rewrote the third bullet to the
rolling wave — "`cherry-pick`ed onto the trunk as it then stands, one at a
time under the ship lock, each as its agent finishes" — and left the first
bullet as it stood:

> - `git worktree add -B <branch> <path> <fromRef>`, where `branch`
>   is `flume/<slug>` (`createWorktree`), and `fromRef` is the tip the tick
>   started on.

Unqualified, that reads as: **every** worktree in a wave is cut from the
tick's pre-head. It describes the tree today — `createWorktree(entry.tag,
preHead)` (`src/waveTick.ts:207`) — and it contradicts the tree the queue is
about to ship. `THE-FREED-SLOT-PULLS-THE-NEXT-DISJOINT-ENTRY`'s acceptance
says a refilled slot is provisioned "cut from the tip it is pulled at", which
is the point of refilling at all: an entry pulled after three merges that is
cut from the pre-head re-earns every conflict those merges already resolved.

Plan cannot settle this — only a human edits `spec/`, and the bullet is a
statement about mechanics, not a wording preference. Three ways it could go:

1. **Qualify the bullet.** `fromRef` is the tip the tick started on for the
   wave's first batch, and the trunk as it then stands for an entry a freed
   slot pulls. Names both cases where the reader is already looking; costs
   the bullet its one-line shape.
2. **Move the qualification to the refill's own sentence.** Leave this bullet
   as the batch's rule and let *Declining a tick before the invocation*
   (`spec/loop.md`) — which `d4185664` already gave the per-entry
   provisioning half — carry the refilled entry's base. Keeps each sentence
   short; the contradiction survives for anyone reading this list alone.
3. **Keep one base for the whole wave** and drop the "from the tip as it then
   stands" half of the refill, so a refilled slot pulls the next entry but
   still cuts from the pre-head. Simplest engine, and it gives up most of
   what the refill was for.

I'd take (1): the list is where a reader goes for what `git worktree add` is
handed, and a rule with an exception stated two sections away is the shape
this repo files against elsewhere.

Filed from the `plan-derive` gate-revert note — `d4185664`'s derivation
opened this question and the revert took the file with it. `derivedThrough`
is untouched here; the derive slice re-derives `d4185664` on its own cursor.
