# spec/chain.md still calls touchedPaths optional

Shipped as written: `stateRootRel` is a required key carrying
`string | undefined`, every hand-built `GateContext` states it, and the doc
comment names relocation instead of fixture compat.

**spec/chain.md ~line 469 is stale on the sibling field.** It still reads
"`commitSha` and `touchedPaths` are optional in the type ... The optionality
exists for hand-built fixtures; a builtin that falls back to its own `git
show --name-only` is covering the fixture case" — every clause retired by
GATECONTEXT-TOUCHEDPATHS-REQUIRED (66e25dd). Build cannot edit `spec/`, so
this needs a human edit or an open question. `commitSha` alone still carries
the optionality, so the bullet wants splitting, not deleting.

That matters beyond tidiness: `commitSha?` is now the last fixture-rationale
optional on `GateContext`, and the entry parked it as spec-ratified — but
the ratification *is* this stale sentence. Fold the question into the same
edit rather than filing it separately.
