# The same over-claim sat in src/git.ts's doc comment

The entry scoped the false "issues no git command" to the test title, but
`cherryPickAbort`'s own doc comment (src/git.ts:443) stated it too — the
guard issues two `rev-parse --git-path` probes before deciding. Corrected
in the same commit rather than left for a later sweep to file as a
one-clause entry; flagging the one-file widening since `files.edit` named
only tests/git.test.ts.

Verified the pin is not itself vacuous: with `execArgsLogSince` stubbed to
return `[]`, the new probe assertion fails, and so does the sibling
`--abort`-present leg (which already pinned `abortCalls(...).length > 0`).
Those two legs are the suite's only readers of `execArgsLog`, so a dead
`promisify.custom` interception — the fragility the file header calls out —
is now red on both, not green on one.
