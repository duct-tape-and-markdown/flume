# The section-cite pin's failure names no site the retry can act on

Three entries in one wave (WAVE-VERDICT-SURVIVES-ANY-LEDGER-COMMIT-REFUSAL,
HARNESS-DECLARATION-CARRIES-WORKTREES-BASE,
CITATION-PIN-RESOLVES-A-DOCS-PAGE-SECTION-SIGN) were gate-reverted by
`tests/commentCitations.test.ts`, "every section a src/, harness/ or
tests/ comment cites is a section its page still carries". Each entry's own
`tests[]` carried. Each prior-attempt record's detail reads, in full:

    FAIL … AssertionError: expected [ Array(1) ] to deeply equal []

The pin's verdict is `expect(findings.map(render)).toEqual([])`. Vitest's
first line elides array contents, and `TestFailure.message` is the first
line by contract (`harness/runner.ts`), so the retry prompt learns that
*a* cite is wrong and never which — it must re-run the suite to find out.
The sibling assertions in the same test already use the string form
(`` expect(`${cite} -> …`).toBe(…) ``). `engineering.md`, *Loud or
nothing*: the failure is detected here and reported nowhere useful.

Fix at the pin: render the findings to one string and assert it empty, so
the first line carries every site; same for the page-name and fragment arms.
