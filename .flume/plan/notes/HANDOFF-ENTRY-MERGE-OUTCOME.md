# One-record-per-tag in `mergeOutcomes` is load-bearing but unpinned

`entries[].mergeOutcome` reads `mergeOutcomes.find(m => m.tag === ...)`
(src/Dispatcher.ts, the `entries` map). Single-valued only because the merge
loop's two non-`continue` pushes cannot both fire for one tag: the
`dropped-work` push (`if (r.tipMoved)`) is followed by the
`afterCommit-reverted` push guarded on `r.footprint`, and `runFanoutEntry`'s
`tipMoved: true` return (~src/Dispatcher.ts:3483) carries no `footprint`.
Every other push `continue`s.

Nothing pins that. Give the tip-moved return a captured footprint later and
one tag gets two verdict records; `entries` reports the first while the
verdict carries both, so a `handoff` sees `dropped-work` and never learns the
span was also gate-reverted.

Candidate: pin the invariant (a wave exercising the tip-moved leg asserts at
most one `mergeOutcomes` record per tag), or make the one-record rule
explicit at the push sites instead of implied by a return shape two
functions away.
