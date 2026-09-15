# The wrap pin covers path citations only; one identifier cite is still broken

The repo pin reds on a wrapped span carrying `/`, per the entry. One wrapped
span breaks an *identifier* citation the same way and is not covered:
`src/cliVerdict.ts:122` wraps `TickVerdictMergeOutcome.` + `tag`, which joins
to `TickVerdictMergeOutcome. tag` — no subject spelling admits the space, so
renaming that type leaves the cite standing.

Widening the pin to "would be a subject once unwrapped" is not free: of the 33
wrapped spans in `src/`, `Directory not empty` (`src/git.ts:21`, `:305`)
un-wraps to a leading-capital word and would red as a dangling citation for
nothing. Whether that wants a narrower rule (a dot or slash inside the span)
or a hand exclusion is plan's call; I did not rewrap cliVerdict.ts, because a
repair with no check behind it is the thing this entry exists to stop.

Second observation: pairing backticks per line was also losing spans *behind*
a wrap — an unpaired backtick shifted the parity of the rest of the comment.
The run-based pairing recovered 4 judged citations (1788 -> 1792, paths 476 ->
478) with no new dangling findings.
