# The records gate still holds half the record conventions

`harness/records.ts` now owns the layout — dirs, note path, byte cap,
liveness. Two record rules stayed chain-side in `recordsGate`
(`.flume/chain.ts:249`): the title line `/^# \S/`, and "a plan slice drains,
never writes". Neither is layout, so neither belonged in this entry, but the
gate extraction (`spec/harness.md`, *The gates the discipline needs*) must
take its paths and its cap from `harness/records.ts` rather than re-spelling
them, or the twin comes back one layer up.

Second: `recordsPending` reports the window **live** on a non-ENOENT read
failure — a deliberate degraded path inherited from the chain. The refusal
that bounds it (the woken slice reading the same dir and failing loudly) is
prose here, because the inbox slice is still chain-side. When the slice moves
into the package, that bound wants to become mechanism.

Third: the state root reaches these functions as an argument, not a
declaration field — `DeclarationSchema` has no `stateRoot`, and
`spec/harness.md` puts the declaration *beside* the root. Worth confirming
that stays positional before another package module needs the root.
