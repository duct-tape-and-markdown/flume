# The sibling `quarantineScope` doc restates its default the same way

Shipped as written: `src/Phase.ts`'s `abortThreshold` doc drops "Default 3.",
and `tests/docComments.test.ts` reads that absence against the imported
`DEFAULT_ABORT_THRESHOLD`, so a future bump can't leave a stale literal green.

Observed next door, same `supervisorPolicy` block: `quarantineScope`'s doc
opens `` `"run"` (default) `` — the same restatement, one line up. It differs
in a way that may matter: the abort default had a named home
(`DEFAULT_ABORT_THRESHOLD`), the quarantine default has none — it is an inline
`opts.quarantineScope ?? "run"` at `src/loopSupervisor.ts:221`. So the fix is
not a deletion but a constant first (`DEFAULT_QUARANTINE_SCOPE`), with
`loopSupervisor`'s own doc reading it. Left unfiled — an engine-surface
addition is plan's call, not this entry's scope.

Not touched, per the entry's held-open note: the `abortThreshold` prose in
`docs/CHAIN-AUTHORING.md:1510`, which still names a number.
