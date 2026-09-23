# A load-sensitive teardown ceiling reverted this entry once, on nothing it touched

This entry's first attempt (1ead6d52) was reverted at `afterMerge` by a red
that its diff cannot reach: `tests/cli.test.ts` > "a bare tick whose agent
ignores SIGTERM kills it after the declared grace rather than exiting over a
live writer", `expected 4141 to be less than 2500`.

The ceiling is `DEFAULT_KILL_GRACE_MS / 2` (2500ms) over a teardown whose
declared grace is `DECLARED_GRACE_MS = 250` (tests/cli.test.ts:2283, :3064).
It is wall-clock over a real spawned tree, so it measures host load, not the
escalation it is about. That file builds its chains by hand
(`bareTickAgentChainSrc`) and imports nothing from `harness/`, so no edit to
`harness/dirListing.ts`, `questions.ts` or `records.ts` is on its path.

Measured on this worktree: the case alone takes 1436ms; the full default lane
is green on the base tip and green with this entry applied (1695 passed,
2m11s). 4141ms is a wave of build suites sharing the host at 4 workers each —
the margin between a 250ms grace and a 2500ms ceiling does not survive it.

Why it matters to plan: the revert cost an entry a full tick and the verdict
named a gate the entry had no relation to. A ceiling keyed off
`DEFAULT_KILL_GRACE_MS` rather than off the declared grace it is
discriminating against has ~10x more slack than its claim needs — the claim is
"the declared grace timed this, not the default", and `DECLARED_GRACE_MS * k`
for a small `k` states that with a bound that is about the subject. Filing
that is plan's call; this tick shipped its own entry as named rather than
touching a case outside it.
