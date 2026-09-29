# spec/loop.md still scopes the claim refusal to "the wave"

Shipped: the singleton merge stage asks `liveForeignClaimPid` before its
pick, at the wave's spelling and the wave's point (inside the ship lock,
ahead of `checkpointBystanderState`), and records `tip-moved` with no tag.

Three docs were scoped to the wave and are now widened in the same commit:
`liveForeignClaimPid`'s own header (`src/tipVerify.ts`), `MergeOutcome`'s
`tip-moved` bullet (`src/tickVerdict.ts`), and
`DispatcherOptions.ownTipClaimPid` (`src/Dispatcher.ts`). The file header in
`src/tipVerify.ts` now names which leg reaches which check outright rather
than asserting "both legs reach them" over a pair only one leg reached.

**For the human:** spec/loop.md's *Tip verify* bullet on the claim refusal
still says "the wave", which is now the narrower of the two truths — the
engine's own `TickVerdict.tipMoved` doc already said "before every
harness-driven commit", which is what made this entry a defect rather than a
feature. A build tick cannot touch `spec/`; the sync is an interactive
session's.

Observed, not filed: both legs now spell the same seven-line pick preamble
(claim check, refusal log, `tip-moved` row) and the same cherry-pick /
absorb / afterMerge / revert sequence, differing only in the entry tag and
in whether a ledger rewrite rides it — a sequence copied across legs, which
`engineering.md`, *A module is one job* calls one function with two callers.
This commit widened the copy rather than closing it, so count it against the
three-notes rule from `git log` rather than from this note. The target shape
would be one `carrySpan` over a tag-optional span, with the ledger rewrite
staying the wave's.
