# docs/CLI.md restates tick's exit codes too — and drops 2

Shipped: the pin derives the range by driving `tickExitCode` over a
`TickOutcome` candidate table (compile error when a field is added) and
compares set-equality against the codes parsed out of `flume tick --help`,
beside a named process-level set holding what the function cannot return.

Two things for the next derive:

1. **docs/CLI.md's `## flume tick` section carries the same list in prose**
   and names only 0/69/1 — the CJS-context 2 is missing there exactly as it
   was mis-attributed in the test. Nothing checks it. `flume check`'s
   CHECK-NO-FANOUT-SKIP-IN-PROSE pins help *and* docs/CLI.md off one real
   run; tick's exit codes have no such pin on the docs side.

2. **Mutation-testing the first cut caught the defect wearing a new
   costume**: fields the table left `ABSENT`-only never exercised a new
   branch, so a `tickExitCode` that grew `if (outcome.declined) return 70`
   still shipped green. Fixed by giving every field a present candidate. Any
   future "drive the real writer" pin wants the same check — that the gate
   goes red when the writer changes one-sidedly, verified, not assumed.
