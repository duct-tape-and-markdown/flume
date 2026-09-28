# Field: a span the trunk already holds reads as a merge failure

Downstream report, 0.19.0, 2026-09-27, three times in one day. A plan-inbox
tick's span, cherry-picked onto a trunk that already carries the same change
(another tick made the same drain), stops on git's "previous cherry-pick is
now empty"; the pick throws, the singleton leg records
`cherry-pick-conflict` and a merge failure, and the tick counts errored —
enough to trip the hibernate. Tree left clean, no sequencer state after the
abort. Same shape on `main`: `cherryPickRange` (`src/git.ts`) has no empty
arm, and both callers (`src/singletonTick.ts`, `src/waveMerge.ts`) read any
throw as a conflict.

Not the case `spec/loop.md`'s `clean-exit` row already rules: that is a span
empty against its **own base**, caught before the merge stage. This span is
non-empty against its base and empty against the **tip** it lands on.

Three things to settle:

- **Detection is told, not inferred.** Keying on git's English stderr is the
  `engine-boundary.md` defect. Durable evidence exists: after the throw,
  `CHERRY_PICK_HEAD` stands and the index equals `HEAD` — or pre-check the
  span's patch-ids against the trunk. The engine's git floor is 2.36
  (`spec/chain.md`); the reporter's `--empty=drop` is 2.45, so it cannot be
  the mechanism.
- **Partial redundancy.** A multi-commit span where only some commits are
  already on trunk: drop those and land the rest, or refuse the span?
- **What the tick reports.** The reporter wants no-commit, not errored. No
  current `NoCommitMode` or merge outcome names "absorbed by the trunk"; a
  new member is a spec clause, so this is likely a question naming the mode
  and how the handoff's refusal table classifies it (`standingRefusal.ts`
  is exhaustive by type).

Also worth a look before filing: *why* two ticks drained the same records.
If a sibling drain on 0.20's tip-read wake (`spec/harness.md`, *The
phases*) can no longer double-drain, the empty pick is rarer but still
reachable by an operator commit landing the same change. Repro to reduce: a
singleton span whose one commit's diff is already on the trunk tip, one merge.
