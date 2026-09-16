# Three declared-shell cases now state their host

The suite already held the mechanism the entry wanted: the declared-host
ledger (`tests/helpers/host-declarations.json`, covered by
`tests/hostDeclarations.test.ts`). Guarding a case without a ledger row reds
that scan, so "never silently" sits at the gate rung here, not in prose.

Split of the three: the two recorder cases skip on win32 with ledgered
reasons; `an undeclared shell runs a command gate under sh` was made
host-honest instead — it spawns `DEFAULT_SHELL` directly as a control and
compares the gate child's `$0` against what the host answered, so it runs on
both lanes. Posix verdicts unchanged.

One gap for the human: `platform-facts.md` has no entry for *win32 spawns no
shebang script* (no loader reads `#!`, and libuv resolves an extensionless
target by appending `.exe`). That fact is now the reason two cases skip, and
it lives only in a ledger row and a fixture comment. The `chmod` section the
entry cited covers the exec-bit half alone.
