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

## 2026-09-10 — a prior-attempt record outlives the entry it was written for (human via flume-main)

1. **Four standing records, zero matching queue entries.** `.flume/prior-attempts/`
   holds records for `buildpriorattempt-tail-bias-gate-revert-details`,
   `pending-schema-core-extension-split` (both `voluntary-bail`),
   `friction-nonenoent-swallowed`, and `test-hermeticenv-strips-tip-claim-held`
   (both `gate-revert`). None of those tags is in `pending.json`; each entry
   left the queue by a plan rewrite, not a ship. `clearPriorAttempt`
   (`src/Dispatcher.ts`) runs only on ship, so a record whose entry plan
   retired, re-scoped under a new tag, or judged already-landed is never
   cleared. Verified on disk at `43cf8e5`.
2. **Consequence.** `TickContext.priorAttempts` reports them as standing, and
   any chain reading "does build have a bail to reconcile" off that map — this
   chain's `plan-audit.shouldRun` — answers yes forever. Today that costs one
   audit tick per outside wake; the audit prompt tells the agent to call the
   record stale in the commit body, and nothing can remove it: the directory
   is engine-owned and outside every phase's fence.
3. **Candidate shape, engine.** The wave-end rewrite already knows which tags
   left the queue (`commitPendingUpdate` diffs the queue it read against the
   one it writes); a record whose tag is no longer in the queue after a plan
   commit is a fact the engine holds. Clear it there, or report it as
   `staleRecords` on the verdict so a chain can act. Widens `spec/loop.md`
   *Prior-outcome feedback* — the human's edit first. Until then the operator
   `rm`s the four files by hand.
