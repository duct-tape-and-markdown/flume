# A parked entry is re-picked before plan reconciles it: eleven parks in a row

Downstream field report, 0.19: one entry parked eleven consecutive times on
the same unanswered question, each park a full tick, because the entry was
re-picked before the drain routed the park. `spec/harness.md`, *The default
`handoff`* already lists a park among the refusals a producer resolves —
"a clean exit, a park, a merge the queue must answer" — and the tree does
not: `RESOLVED_BY_A_PRODUCER["not-shipped"]` is false. The spec is right
and the code is behind it; under one tick the inbox ran first and hid it.
A continuation is also `not-shipped` and must re-pick at once, which the
harness tells apart by the note's location. File the reconcile.
