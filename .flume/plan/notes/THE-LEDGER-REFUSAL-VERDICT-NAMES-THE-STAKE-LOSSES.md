# The refusal verdict's fact list is a hand-copied argument list

Shipped as filed: `WaveMergeRequest` gained `stakeLosses`, `waveTick` hands
them over, the refusal's `buildTickVerdict` call names them. The completing
leg's existing check was retitled to the entry's `pins[]` line; the new case
sits beside it in "Dispatcher fanout — the per-entry claim".

Observed, and larger than this entry: `buildTickVerdict` is one shaping with
two producers, which is why a field cannot reach one verdict and miss the
other's *shape* — but the refusal producer's *arguments* are still a
hand-assembled list inside `runWaveMerge`, fed by a hand-assembled
`WaveMergeRequest`. That is exactly how this defect happened: `stakeLosses`
was added to the leg's return and to `TickVerdictFacts`, both sides compiled,
and the refusal site silently kept reporting the entry as simply absent. The
type system cannot catch the next one either — every fact on
`TickVerdictFacts` is optional, so an omitted argument is legal.

Candidates, if plan wants to close the class rather than the instance:
- a single `waveFacts` value the leg builds once and both the refusal site
  and the leg's own return spread into `buildTickVerdict`, so the two
  producers share one argument list rather than two copies; or
- an agreement check over the two legs of one wave — same wave facts, once
  through the completing path and once through the refusal path — asserting
  every fact field the completing verdict names is named by the refused one.

The second is the cheaper pin and would have reddened on the pre-fix tree
here. Worth weighing against how many more facts the wave is likely to gain.

No blockers. tsc and the suite are green.
