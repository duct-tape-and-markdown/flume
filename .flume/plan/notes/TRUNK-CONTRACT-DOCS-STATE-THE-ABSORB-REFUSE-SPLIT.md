# Absorption residue in CHAIN-AUTHORING's prior-attempt vocabulary

Shipped as written (README + docs/CLI.md). One doc site outside the entry's
scope still carries the pre-absorption framing:

`docs/CHAIN-AUTHORING.md:1188` — the `tip-moved` prior-attempt variant reads
"the ref moved between tick start and the point the commit would have landed,
so the commit was discarded." That is the retired expected-sha comparison at
the merge site. On disk the record is written only by `checkTipMovedPerEntry`
(`src/Dispatcher.ts:3522`), the agent-branch ancestry leg: `expectedTip` is
the recorded *base*, `observedTip` the observed HEAD, and the discard is a
soft reset on the private worktree branch, never trunk. The wave's own claim
refusal (`Dispatcher.ts:2591`) pushes a `tip-moved` merge outcome but writes
no prior-attempt record — so a chain author reading that bullet expects a
variant the harness-commit-site refusal never emits.

Worth an entry: same `per`, plus the per-entry leg's bullets. The reword is
mechanical; the correctness-adjacency is that the doc names the wrong
producer for a record chains read.
