# Two porcelain parsers now, engine and harness

`git.trackedModifications` (src/git.ts) and `cleanTreeGate`
(harness/gates.ts) each spawn `git status --porcelain -z` and each carry
the same record decode: two-byte code, `slice(3)` path, `i += 1` to eat a
rename/copy origin field. They differ only in the filter — the gate keeps
untracked paths inside the fence and refuses; the engine drops `??` and
reports. That is the shape `engineering.md` *A fact the engine holds is
reported* names: the harness restating an engine decode. The entry's own
note already parks the adoption ("a later entry, not this one"), so this is
just the confirmation that the duplicate is real and where it sits.

Second, scoping fact for whoever files that entry: the new field lives on
`TickVerdict.invocations[]` (one row per agent run, tagged under fanout),
not on `TickResult`. A gate reads `GateContext`, which carries neither — so
adoption needs a decision about how the fact reaches a gate, not just a
delete of the harness copy.
