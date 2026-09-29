# A committed span that settles behind a refusing pick reaches the verdict with no outcome row

Shipped as filed: the refusal verdict is built at the wave leg's throw
(`waveMergeError`, `src/waveMerge.ts`), and an attempt a walled wave will not
carry now takes the trunk-free half of the merge (`foldAttemptFacts`) instead
of being dropped whole.

Two things for the next derive.

1. **No outcome row for an uncarried span.** An attempt whose agent *committed*
   and whose slot settled after the refusal is folded (invocation row, timings,
   gate rows) but gets no `mergeOutcomes` entry: it never reached cherry-pick,
   and the outcome union has no kind for "the wave was walled before this span
   was carried". Its commits are live on the entry's worktree branch and the
   worktree survives the refusal, so nothing is lost — but the base/head pair
   `spec/loop.md`, *The tick verdict — one facts artifact* calls recovery is not
   on the artifact, and the operator clearing the refusal has to find the branch
   by hand. Pre-existing (the attempt was dropped entirely before), narrower
   now, and it wants a spec ruling on the kind's name before an entry.

2. **A pin held.** Moving the fold ahead of the ship lock first broke
   `mergeAttempt`'s `w.mergeOutcomes.slice(outcomesStart)` boundary: the fold
   contributes this pick's own afterCommit-reverted row, so a boundary taken
   after it emptied the slice and `commitAttemptLedger` returned early — the
   rewrite never ran and the refusal never happened. Caught by "a ledger-rewrite
   refusal over a wave that shipped nothing carries the wave's gate-revert
   cause", the case whose comment says it is the only shape that evaluates that
   leg. Worth knowing the slice boundary is load-bearing for anything that
   reorders the stage's accumulators.
