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

## 2026-07-29 — TAG_PATTERN rejects tag shapes the rendered schema permits (jeff pass, DAL job mining)

`src/PendingSchema.ts:71,81` — the parenthesized slice of a tag must match
`[a-z0-9]+`, but the prompt's rendered `"TAG-NAME(slice)"` schema never
states that constraint. A `DAL-REWIRE(usp_Filter_Get)`-style tag (mixed
case, underscores) passes the rendered shape and fails the real regex —
burned a full tick revert on centercode-platform's DAL job (its commit
`bb3ef7f2b2`). Same failure class as v0.7 §2 (harness misstates its own
enforcement), here for tags. Fix direction either way: loosen the regex
to what the `MAINTAIN-tsc-a31893e` precedent already tolerates, or render
the real constraint into the prompt's schema block. S.

## 2026-07-29 — pending.json notes cap invisible at derivation time (jeff pass, DAL job mining)

The ~500-char notes field cap is enforced only by the commit-time
validator; derivation-time guidance never states it. Two plan ticks on
the DAL job reverted on field-length violations the prompt could not
have warned about ("notes trimmed to fit the 500-char schema cap —
prior attempt was reverted for exceeding it"). Surface the cap in the
derivation-time prompt/schema rendering. Distinct from the deferred
v0.8 structured-verdicts family — this is cap visibility, not semantic
validation. S.
