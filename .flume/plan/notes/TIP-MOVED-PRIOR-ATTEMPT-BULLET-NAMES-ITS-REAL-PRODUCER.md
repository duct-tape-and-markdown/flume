# Widened past the two named files; one twin left unfixed

The entry named two sites; the same stale claim ("the ref moved between tick
start and the point the commit would have landed") lived in four. Acceptance is
a global claim over prose describing the record, so this shipped all four: the
docs bullet, `buildTipMoved`'s doc, `TipMovedAttempt`'s interface and field docs
(src/Prompt.ts:180), and the render block itself
(src/Prompt.ts:639), whose labels read `Tip expected at tick start:`. That last
one is a behavior change the empty `tests[]` did not anticipate; it ships with
an unnamed pin in tests/Prompt.test.ts.

**Left unfixed, wants its own entry:** `TickVerdict.tipMoved` and
`TickOutcome.tipMoved` (src/Dispatcher.ts:376, :1385) still document the *tick
fact* as "refused to commit because the ref moved between the tip it recorded at
tick start and the point a commit would have landed." That fact now has two
producers — the claim refusal and the ancestry leg — and neither is a recorded-
tip comparison. Different surface from the record, so out of scope here, but it
now contradicts what this commit wrote.
