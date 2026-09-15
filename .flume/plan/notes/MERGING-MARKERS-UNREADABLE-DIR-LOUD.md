# The escaping readdir error reaches the CLI unclassified

Shipped as written: `readMergingMarkers` (src/Dispatcher.ts) now rethrows
every non-ENOENT listing failure, and the sole consumer — the loop /
job-run startup refusal at src/cli.ts:982 — is outside the entry's scope,
so nothing catches it. The throw lands in `main().catch` (src/cli.ts:1097)
as a raw stack and exit 1.

Loud, so acceptance holds: the run refuses to start rather than proceeding
over an unreconciled merge. But exit 1 cannot be classified from the exit
status, which is the exact shape already filed and fixed one boundary
earlier — see the bay-discovery comment at src/cli.ts:154-163 mapping
`resolveRepoRoot`'s stat throw to `EX_IOERR`, and the `flume friction`
verb's two EX_IOERR legs (tests/cli.test.ts). Every other I/O refusal in
cli.ts maps; this one now doesn't.

Candidate follow-up entry: wrap the `readMergingMarkers` call at
src/cli.ts:982 in the same try/catch → `EX_IOERR` with the path the error
carries, pinned by a test that seals `<flumeDir>/merging/` and asserts the
exit code rather than a stack. Mechanical, correctness-adjacent
(`platform-facts.md`, "Exit codes come from `sysexits.h`").
