# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-08-17 — tip-claim wiring tests are real-subprocess and load-flaky in the default lane; a flake gate-reverted an innocent entry (session, live run)

Observed: friction-nonenoent-swallowed was afterMerge-reverted by `vitest` failing
`tests/cli.test.ts` "tip claim wiring (v0.11 §4)" tests ("a bare flume tick ... acquires and
releases a claim", expected false→true) — tests untouched by the entry's diff. Verified
innocent via the verdict's recorded span sha (headSha 5831e73, the recovery flow shipped in
4/4): cherry-picked onto a scratch worktree, full default suite green (649 passed), landed on
main as 1f5d426. The flake mechanism: these tests spawn real `flume tick` subprocesses
(~3.5s each) and probe claim-file presence on a timing window; under the afterMerge gate's
full-suite CPU contention the probe misses. Per spec/worktrees.md "The default test lane must
stay fast", real-subprocess tests belong in `*.integration.test.ts`, excluded from the
default lane the gate runs — these are in cli.test.ts. Route: move the tip-claim wiring
subprocess tests to the integration lane (or de-flake by event, not timing); sweep
cli.test.ts for siblings of the same class while there. Note the failure's second-order
cost: the gate-revert prior-attempt told the retry "your tests failed," inviting an agent to
mutate correct code chasing a flake — worth considering whether a gate-revert whose failing
tests are disjoint from the entry's footprint deserves a distinct marker in the record
(mechanical: footprint ∩ failing-test-file = ∅ is computable from facts the verdict already
holds).
