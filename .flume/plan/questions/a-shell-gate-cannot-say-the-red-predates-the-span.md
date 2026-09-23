# Only the judge can declare `blamesSpan: false`; a shell gate blames the span for a red it inherited

`GateResult.blamesSpan` (`spec/chain.md`, *What a gate returns*) is live, and
`namedLinesGate` sets it on `base-red` — the one gate in the package that
observes a base run at all. Every other gate this repo declares is
shell-backed: build runs `tsc` at `afterCommit` and `afterMerge`
(`.flume/declaration.ts`), and neither run has a base to compare against. So
a type error inherited from trunk reverts the span, quarantines the entry,
and keys blame on a failure that predates it — the case the field exists to
stop, in the gate that costs seconds rather than minutes.

A shell gate's base arm means running its command against `ctx.baseSha`, a
checkout the `afterMerge` lane does not do — so no tick closes this alone.

## Options

1. **Each shell gate re-runs at the base on failure.** Correct, and the most
   expensive: a checkout per failed gate run per entry, on the wave's hot
   path — a shape nothing else here has.
2. **The engine rules base-red once per wave, ahead of the gates**, and hands
   every gate the fact. Cheaper by wave width, but it is the engine deciding
   what a gate means, which `engine-boundary.md` routes to the chain, and it
   pays on green waves too.
3. **Leave the asymmetry and declare it.** `Gate.failingFiles`' doc already
   says the shell builtins attribute nothing, "having no structured report to
   attribute from"; one sentence extends that to `blamesSpan`. A red trunk is
   loud anyway — every entry in the wave reverts.
4. **The chain absorbs it.** Retry policy is the chain's
   (`engine-boundary.md`, *Routing rule*), but it needs a fact the engine
   does not report: how many of the wave's entries failed the same gate.

I'd take 3 now, 4 if red trunks cost real churn. 1 and 2 are complicated
enough to be `collaboration.md`'s signal.

Filed from the build note on `JUDGE-GATE-DECLARES-BLAMESSPAN-FALSE-ON-BASE-RED`.
