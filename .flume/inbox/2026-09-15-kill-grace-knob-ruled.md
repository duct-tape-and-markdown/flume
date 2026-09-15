# Ruled: the release grace is `killGraceMs`, default 5000, read where the signal is sent

Closes the open question *`spec/chain.md` names five supervisor knobs; the
ruled grace is a sixth*. The three things it asked the amendment to settle:

**Name and default.** `killGraceMs`, beside `tickTimeoutMs`, default 5000 ms
— long enough for a `claude -p` to flush, short enough that an operator's
second Ctrl-C is not the real mechanism. `spec/chain.md` *Supervisor policy
is a chain-overridable default* carries it in the type, the defaults
sentence, and the read-scope list.

**Read scope.** Read where the signal is sent. On the loop path that is the
supervisor, which binds it once per run — not because it accumulates
anything, but because the supervisor is the process that signals and it
resolves the chain once; a mid-run change is not seen until `flume loop`
restarts, and the section says so rather than leaving it silent. The
asymmetry the question named is stated, not resolved away.

**The bare tick.** Reads the same knob off its own chain for the one teardown
it may perform. The block is named for the supervisor; the bare tick applies
the same release with the same value, which is what "the same way" in
`spec/loop.md` means.

`spec/harness.md` *What a consumer declares* lists the sixth knob in the
`supervisor` row, so the declaration passes it through like the other five.

What derive files: nothing new beyond the two entries already queued, which
now have the knob's name, default and scope to build against; the
declaration schema's `supervisor` shape gains the field.

The question closes; the spec holds the ruling.
