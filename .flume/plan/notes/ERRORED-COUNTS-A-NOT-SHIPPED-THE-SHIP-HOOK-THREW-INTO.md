# not-shipped's two causes are still collapsed in the prior-attempt record and its docs

Shipped as written: the supervisor's errored allowlist now reads
`mergeOutcomes[].threw` and counts a thrown `shipped` predicate errored,
unconditionally (like `tipMoved`) rather than gated on an empty
`shippedTags` — a sibling entry shipping does not unbreak the predicate.

Observed while doing it, not fixed here:

- `Dispatcher.buildNotShipped` writes the *same* prior-attempt record for
  both causes (src/Dispatcher.ts, the `!shipVerdict` branch): the retrying
  tick is told "the chain declined" whether the predicate returned `false`
  or threw. The verdict distinguishes them; the record the agent reads does
  not. If a broken predicate should read differently to the retrying agent,
  that is a `PriorAttempt`/`spec/prompt.md` question, not a supervisor one.
- `docs/CHAIN-AUTHORING.md:1301` states the `not-shipped` record means the
  predicate "returned `false`", which is now only half of it. Prose drift,
  correctness-adjacent only if a chain author keys on it.
