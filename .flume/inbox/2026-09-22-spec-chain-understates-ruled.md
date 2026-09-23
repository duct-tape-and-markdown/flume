# Ruled: `spec/chain.md` understates what the engine reports

Ruled by the interactive session under standing direction; both spec
edits land in this commit.

1. *What a hook receives* — (b): once
   TICK-RESULT-REPORTS-THE-WAVES-MERGE-FAILURES ships, the `TickResult`
   bullet names the three stage-failure classes the verdict carries —
   provisioning, gate, merge — in one sentence rather than a list that
   drifts per field.
2. *The builtin gates* — (a): one sentence names the asymmetry
   (`blamesSpan` is the judge's alone; a shell-backed gate blames whichever
   span happened to be gated over a base already red) and the backstop that
   bounds it (the consecutive-identical-failure abort, which holds while the
   wave's failures share a signature). (c), a `blamesSpan` knob on
   `shellGate`, is the right shape if a chain ever asks and is filed then.
