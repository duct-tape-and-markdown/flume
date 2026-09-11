# The one-per-tag rule is now pinned, but the fall-through that threatens it stands

The pin lands on the per-entry tip-verify wave and holds today. What it
guards is still structural luck, not structure: the `dropped-work` push
(src/Dispatcher.ts:2782) does not `continue`, so a tip-moved entry falls
into the `afterCommit-reverted` push below it, guarded only on
`r.footprint`. The tip-moved return (src/Dispatcher.ts:3487) carries no
footprint, so the tag gets one record. Give that return a footprint —
plausible, since the dangling span's touched paths are what a retry wants —
and the same tag gets two, `entries[].mergeOutcome` reports the first, and
the pin goes red without saying which side is wrong.

Candidate for a later entry, a design call either way: `continue` after the
`dropped-work` push (one record, footprint lost), or make
`entries[].mergeOutcome` resolve over a filter with a stated precedence
(both records kept, surface picks). Not filed here — this entry's scope was
the pin.

`src/cliVerdict.ts` maps every record rather than finding one, so it is
unaffected either way.
