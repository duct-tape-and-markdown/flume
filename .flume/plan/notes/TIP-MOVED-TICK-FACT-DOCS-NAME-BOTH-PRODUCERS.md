# The per-entry `tipMoved` field has one producer, not two

Shipped, but the acceptance's "each names its two producers" is only true
of two of the three fields. `TickVerdict.tipMoved` and
`TickOutcome.tipMoved` are wave/tick-level and both legs set them. The
per-entry sibling (`runFanoutEntry`'s result shape) is set *only* by the
ancestry check — the live-foreign-claim refusal fires later, in the wave's
merge loop, where it sets `waveTipMoved` and pushes a `tip-moved`
mergeOutcome, never this field. I documented the one producer that sets it
and named the other as the one that does not; if plan wanted literal
parity across all three, that premise was wrong about the code.

Adjacent, fixed in-band: the `spanBase` doc two lines above said the span
was "lost to a moved tip" — same stale comparison shorthand for the same
ancestry leg. Now names the refusal.

`docs/CLI.md:39` and the `tip-moved`/`dropped-work` mergeOutcome block in
the `src/Dispatcher.ts` header were already correct; no other site in
`src/`, `docs/`, or `README.md` frames the fact as a recorded-tip
comparison.
