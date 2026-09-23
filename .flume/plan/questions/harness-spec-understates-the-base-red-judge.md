# `spec/harness.md`, *The judges* does not state the base re-run or `base-red`

The section reads, whole: "`tests[]` lines are proven green on the merged tree
and red on the base; `pins[]` lines green only. The judge speaks to the
consumer's test runner through the runner interface below and never assumes
vitest."

Since `JUDGE-REPORTS-A-SUITE-RED-AT-THE-BASE-AS-BASE-RED` shipped, the judge
does a third thing the section never mentions: when the merged suite is red
and **no failing file is in the span's footprint**, it re-runs those files at
the base through `runAtBase` and, if they fail there too, refuses with
outcome `base-red` — a verdict the gate carries onto the tick verdict and the
prior-attempt record (`spec/chain.md`, *What a gate returns*).

So the spec is narrower than the package: a reader of *The judges* alone
would not know a red suite is ever re-run, nor that a refusal can say the red
was inherited. Same shape as the CJS sentence ruled at 5a463d25 — spec behind
shipped behavior, on the spec's side — and `spec/` is the human's surface, so
neither plan nor build can close it.

No fork worth costing. Proposed sentence, to follow the first:

> A merged suite red only in files the span never touched is re-run at the
> base; failing there too, the judge refuses with `base-red` rather than
> blaming the span.

One thing the wording should settle: whether the section names the
footprint condition (as above) or leaves it to `spec/chain.md`. Naming it is
what makes the sentence decidable — the re-run is *not* attempted when a
failing file is in the footprint.

Filed from the build note on `JUDGE-REPORTS-A-SUITE-RED-AT-THE-BASE-AS-BASE-RED`.
