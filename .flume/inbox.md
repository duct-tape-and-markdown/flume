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

## 2026-07-29 (pass, operator) — voluntary-bail waves carry no plan-wake signal
SETUP-WORKTREE-HELPER bailed twice (declared `.flume/chain.ts` is off-fence
for build ticks; the refusal is correct per prompts/build.md). But the
build phase's handoff wakes plan only on ships/gateResults, so a pure-bail
wave hibernates instead — the prompt's promise ("plan re-derives next tick
and routes it as an open question") never fires, and the queue stalls
silently until an operator wakes plan by hand. A bail is plan-worthy
signal: route-the-gap is exactly plan's job. Chain handoff (or an engine
default) should treat voluntary-bail > 0 as wake-plan. Size S.
