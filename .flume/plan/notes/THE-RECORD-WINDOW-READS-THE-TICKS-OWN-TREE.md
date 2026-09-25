# The record wake still reads the shared root; only the render moved

Shipped: `renderRecords` (`harness/inboxWindow.ts`) now lists and reads the
record queues under `join(ctx.cwd, stateRootRel)`. Friction and lanes stay on
`ctx.flumeDir`, both gitignored.

Residual, and the reason the header paragraph now names two trees: the
liveness leg cannot move with it. `HandoffSlice.live` is handed `flumeDir`
alone — no `cwd`, no worktree exists at the handoff — so
`recordsPending(inputs.flumeDir, ...)` still counts the primary checkout's
working tree. A record the shared disk holds and a fresh worktree's base does
not (an operator's inbox file still uncommitted; a build note that landed
after this worktree was cut) now wakes the slice and renders as `(no
records)`. Cost is one drain tick per such record, until the file is committed
and a worktree is cut past it — strictly cheaper than the pre-fix loop
(70bb7045 -> db75a751: ten records routed every tick and removable by none),
but it is a real wake the render answers nothing for.

The clean close is the same `per` section (`spec/pending.md`, *Dispatch reads
come from the tip, not the tree*) applied to the wake leg: count the records
at `HEAD:<stateRootRel>/<dir>` off `options.repoRoot`, not the working tree.
`harness/dirListing.ts` has no listing-at-a-ref, and the engine reports no
tree listing a window could read, so that is an entry, not a follow-on here —
and it seams `harness/records.ts` plus whatever surface gains the ref listing.

Second-order, for a human rather than the queue: an operator's finding is now
invisible to the drain until it is committed. `.claude/rules/spec-plan-build.md`
already files inbox records under a commit prefix, so this is that rule made
mechanical — but nothing states it where an operator dropping a file would
read it.
