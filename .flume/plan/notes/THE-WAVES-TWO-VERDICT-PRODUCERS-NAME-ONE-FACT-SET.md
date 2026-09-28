# The refusal's fact set is a function of when the refusal fires

The two producers agree today — both pins land green, and dropping
`renderFailures` from `ledgerRefusal` (`src/waveMerge.ts`) reds both.

What cost the tick its first two attempts is worth plan knowing. A pick's
ledger rewrite is scoped to that pick (`commitAttemptLedger`,
`src/waveMerge.ts`), so the refusal fires at the first rewrite past the
corruption, and the refused verdict names only the facts recorded by then. A
wide wave (maxParallel 8) therefore reds the comparison over `declined`,
`renderFailures`, `mergeFailures` and `gateFailures` with both producers
correct: the refusal simply happened before those entries settled. That is a
false finding waiting for the next reader of a wide-wave verdict, not a defect.

The fixture answers it by running one slot wide: every entry goes through
provisioning, render, agent and merge in queue order, the corruption lands in
the last entry's agent, and the two legs are one wave's facts read at one
point. Ordering is `priority` descending, so the entry list is the schedule.

Two conditional facts stay outside the comparison, spelled in the test rather
than left to read as covered: `noCommit` and `tipMoved`, neither reachable by
a wave that shipped a span. A fact a future wave records *after* its last
rewrite is likewise unreachable here — if one appears, this pin will not see
it and the entry that adds it owes its own case.

One incidental: the phase declares `.flume/plan/pending/**` writable beside
`src/**`. Without it a refill read over the corrupted queue is a bare refusal
(`readPendingForDecision`, `src/pendingLedger.ts`) that walls the wave with a
throw carrying no verdict at all — which is also how the refusal reaches
`tick()` with `ledgerRefusal: "parse-failure"` and no verdict, a shape a chain
reading the artifact cannot distinguish from a tick that never ran.
