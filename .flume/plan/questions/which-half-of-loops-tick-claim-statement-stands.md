# `spec/loop.md` states both halves: does a bare `flume tick` take the tip claim?

From build note THE-TICK-PAGE-STATES-THE-TIP-CLAIM-IT-TAKES. The entry corrected
three downstream prose copies; the fourth is the spec locus, which is yours.

One page, twelve lines apart, states both halves:

- *Scope* (`spec/loop.md:182`): "A bare `flume tick` acquires and releases around
  its single tick, refusing (exit 1) when another live process holds it", with
  the rationale beneath it — claimless ticks left the startup sweep no way to
  know a live wave owns the worktree base.
- *Detached HEAD is refused* (`:189`): "`tick` refuses even though it takes no
  claim, so behavior is identical whether or not a loop wraps it."

**The runtime agrees with *Scope*.** `src/cli.ts:1271` acquires when
`FLUME_TIP_CLAIM_HELD` is unset — i.e. exactly when no loop wraps the tick — and
refuses on `TipClaimHeldError` with exit 1.

**This is stale prose, not a fork.** The `:189` clause dates to b622b158
(2026-08-03), which flattened the corpus; 51976994 — *"tick takes the claim"* —
then made the bare tick acquire and wrote the *Scope* bullet, without revisiting
the sentence twelve lines below. So the proposal is narrow: drop the
"even though it takes no claim" clause and the "identical whether or not a loop
wraps it" conclusion it carries, leaving the bullet's own ruling — both commands
refuse detached HEAD before any work, exit 1 — which the runtime does hold. The
surviving sentences (`:188`, "the claim keys on a ref") already state why.

**Why it is here and not an entry.** `spec/` is outside build's fence, so no
entry can carry the edit; and nothing pins `spec/loop.md` against the runtime, by
ruling rather than by omission — `.claude/rules/engineering.md`, *Narration is
the ladder's bottom rung* holds that prose about the harness itself, `spec/`
named, is its authors' and is never promoted into the suite. So the sweep's
retired-claim delta cannot see this either: the line was never deleted, only
outlived. Every downstream copy the entry found read as a paraphrase of `:189`,
so a fifth copy is one derive away while it stands.
