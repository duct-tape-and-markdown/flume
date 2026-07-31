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

## 2026-07-31 — two pending entries are v0.11 demolition tail (human)

spec/RELEASE-v0.11.md (the boundary line, committed 1e517d9) removes `jobExtract`, `Chain.harvest`, and all branch legs from `src/job.ts`, and rewrites `tests/job.test.ts` heavily. Two open entries land in that blast radius and should be deferred (blockedBy a future v0.11 entry, or dropped with a disposition note) rather than shipped now:

- `ERA-SCOPED-NARRATION-JOB-NEIGHBORHOOD` — cited lines job.ts:570 and :793 sit inside extract, which v0.11 §3 deletes outright; :417's pre-0.9 clause is in code v0.11 rewrites. Prose polish on code slated for deletion.
- `RUNTIME-IGNORES-LOOP-VACUITY-PIN` — the pinned behavior (jobNew ignore-merge) survives, but tests/job.test.ts is v0.11's most-churned file; landing pins now does the work twice. Fold into v0.11's test rewrite.

Related, no action needed yet: `TEST-CLI-SUBPROCESS-HARNESS-SHARED`'s repro asserts the leak via the HEAD branch-guard exit (1 vs 78), which v0.11 §2 removes — ship it as-is, expect that one assert to be re-expressed post-v0.11.

Note: v0.11 ships AFTER v0.10 (sighted-render) — do not derive v0.11 entries while v0.10 sections remain unshipped.
