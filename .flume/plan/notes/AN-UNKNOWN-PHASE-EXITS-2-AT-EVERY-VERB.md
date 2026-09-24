# The exit-code matrix pins a range, not an arm

`tests/cliHelp.test.ts`'s outcome/exit-code agreement matrix
(CLI-HELP-TICK-MISSING-EXIT2, CLI-DOC-TICK-EXIT-CODES-PINNED) drives
`tickExitCode` over the whole `TickOutcome` space and compares the **set** of
codes it returned against the codes the help page and `docs/CLI.md` name. That
set is unchanged by this entry: 1 is still reachable through
`ledgerRefusal: "commit-refusal"`, so moving `undeclaredPhase` from 1 to 2 left
both pins green with nothing red anywhere. The end-to-end case in
`tests/cli.test.ts` is the only thing that reds on the arm.

So the standing gate proves "the pages name every code the verb can return"
and proves nothing about which outcome maps to which code. Any future
re-routing between two codes already in the range ships green over both prose
copies, and the prose copies are exactly where the per-arm claim lives: each
code's block in `--help`, and each cause clause in `docs/CLI.md`, names causes
that nothing reads back against the producer.

`sentencesNamingExitCode` (same file) already exists and is the reader that
could close it: it scopes a `docs/CLI.md` window to one code, and the loop
section's I/O case uses it to pin artifacts named in that window against what
real refusals report. The analogous tick-side check needs the outcome space
labelled — each candidate carrying the phrase its arm should be documented
under — which is a design decision, not a mechanical extension, so I did not
build it inside this entry's scope.

Filing hint: an entry against `.claude/rules/engineering.md`, *A seam gate
reads what the real writer wrote* — the claim under test is per-arm agreement,
and today only the range is driven.
