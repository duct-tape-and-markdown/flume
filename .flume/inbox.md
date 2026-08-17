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

## 2026-08-17 — second innocent gate-revert in one day: default lane still load-flaky, and the failure digest truncates the signal (session, live run)

test-hermeticenv-strips-tip-claim-held (a one-line strip-list addition, span 8da2af6) was
afterMerge-reverted by vitest; full default suite green on the recovered tree (637 passed),
landed on main via the verdict-sha recovery flow — same as friction-nonenoent-swallowed
hours earlier. Two compounding findings:

1. The lane fix (e34c41e) moved the tip-claim wiring tests out, but at least one more
   load-flaky test remains in the default lane — identity unknown (see 2). A systematic
   sweep of the default lane for real-subprocess/timing-probe tests is warranted, not
   another one-at-a-time move; `Dispatcher.test.ts`'s subprocess-spawning tests are the
   named suspects.

2. The gate-revert digest is bounded head-first: both records kept ~1.2KB of leading
   stderr noise from PASSING tests and truncated before vitest's "Failed Tests" block —
   the one section the retry (and the operator) needs. Twice today the failing test's
   identity was unrecoverable from disk. Correctness-adjacent per engineering.md "Loud or
   nothing"/prior-attempt's own charter ("a digest, not a transcript" — it is currently a
   transcript prefix, not a digest): the capture should extract the failure block
   (vitest's FAIL/Failed Tests section) before applying the cap, falling back to
   tail-biased truncation when no such block parses.

3. (Restating with new urgency) both innocent reverts had failing tests disjoint from the
   entry's footprint — the footprint ∩ failing-test-file = ∅ marker floated in the earlier
   flake finding would have flagged both records as suspect-flake at revert time.
