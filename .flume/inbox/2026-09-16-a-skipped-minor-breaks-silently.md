# A consumer jumping 0.14 → 0.16 missed 0.15's break, and the compiler could not tell them (pilot report from a win32 consumer on node 22, relayed by the operator)

`voluntary-bail` → `clean-exit` (0.15) hit a `shouldRun` comparing a
prior-attempt record's `mode` against the old literal through a local
`{ mode?: string }` cast: typechecks clean, always true, brake disarmed.
`docs/` has notes for 0.10, 0.11, 0.12 and 0.16; the 0.16 note names the
gap only in its closing *See also*.

Ruled at `spec/cli.md` *Versioning policy*: a migration note opens by
naming the minors it does not cover. What derives: that line at the head of
`docs/MIGRATING-0.16.md`. Also for docs: `PriorAttempt` and
`PriorAttemptMode` are exported today — the note's § 3 example should read
the record through them, since a string literal is the contract the rename
broke.
