# A gate-revert blames the entry for a suite that was already red

## What happened

Wave 1 merged two commits that were each green in their own worktree against
a base that lacked the other: one wrote a comment cite naming a
`posture-sweep.md` phrase that is a mid-paragraph bold, the other shipped the
resolver that reads such cites. Trunk was red on the pin from that merge on.

Wave 1's last entry and both of wave 2's were then gate-reverted by the
`named lines` gate with "the suite is not green" — each carrying its own
lines, each failing on a line no diff of theirs touched. Verified by running
the pin at both reverted shas: one identical finding, the one already on
trunk. Three entries paid a worktree and an agent for nothing, and the loop
retried them into the same wall until a human fixed the cite.

## Why the harness cannot currently tell

`spec/worktrees.md`, *Per-entry `afterMerge` revert isolation* rests the whole
attribution on one premise: the entry's commit "is the only delta between the
pre-cherry-pick tip and the merged sha". True of the *diff*, and false of the
*verdict* whenever the pre-cherry-pick tip was already red — nothing checks
that it was not.

`judgeNamedLines` (`harness/judge.ts`) returns `outcome: "suite-failed"` on
`!run.ok` **before** any base run happens, so the one observation that would
settle it is never taken. The engine's `suspectFlake` marker
(`spec/chain.md`, *What a gate returns*) is an inference from list
disjointness — the entry's footprint against the gate's `failingFiles` — where
the fact available is a run at the base (`.claude/rules/engine-boundary.md`,
*Told, not inferred*; *Evidence must be durable*).

## The fork

The runner interface has two operations here, and neither is quite the one a
trunk-red check wants:

- `runAtBase(names, files, baseSha, cwd)` lays the *working-tree* bytes of
  `files` over a detached checkout of `baseSha`. For a failing file the entry
  never touched — the measured case — the overlay is a no-op and this answers
  correctly today, with no interface change. For a file the entry *did*
  change, the overlay carries the entry's own bug to the base and would
  report its own breakage as trunk-red. That direction is the dangerous one.
- A base run with no overlay would answer both, and is a third observation
  every consumer's `Runner` must then implement.

Options, roughly in ascending cost:

1. **Nothing in the harness; fix the source.** Keep mutually-dependent
   entries out of one wave. Does not help the case where a human lands a red
   on trunk between waves.
2. **Overlay-only check, scoped to untouched files.** On `!run.ok`, re-run
   only the failing files the entry's footprint does *not* contain, through
   the existing `runAtBase`. Red there is reported as a base fact; a failure
   in a file the entry touched stays the entry's. No interface change; costs
   one extra partial run per red; silent on the mixed case.
3. **A fourth `Runner` operation — run at the base as it stands.** Answers
   every case, and every consumer's runner grows a method for a situation
   most will never hit.

And whichever mechanism: what the gate does with the fact is the chain's, not
the engine's (`engine-boundary.md`, *Routing rule*). The harness gate could
still revert — the entry is unjudgeable either way — but report
`verdict: "base-red"` so the retry's prior-attempt record stops blaming the
entry; or it could decline to revert at all and let the wave stand on a tip
that was already broken.

**The ask:** which of 1/2/3, and does a base-red gate still revert?

Filed from `.flume/inbox/2026-09-22-a-red-trunk-reverts-every-later-entry.md`.
