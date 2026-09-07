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

## 2026-09-07 — a park is invisible on the surface chains already read (cascade-integrations via flume-main)

1. **`not-shipped` leaves nothing where a chain looks for prior outcomes.** Two
   chains hit the same livelock independently: flume's `plan.shouldRun` keyed on
   bail records and the inbox (fixed chain-side in 4ee48ee by reading the last
   build verdict), and cascade's `build.handoff` re-picks a capture-only commit
   for the same reason (fixed chain-side there, 0.13-compatible). Cause in both:
   a park is a committed `not-shipped` merge outcome, so no `PriorAttempt` is
   written and neither `TickContext.priorAttempts` nor quarantine ever sees it —
   the chain has to know to read the verdict log instead. Two consumers carrying
   the same block is the detector (`engine-boundary.md`, *Surface, not
   prescription*). Ruling needed: whether `not-shipped` writes a prior-attempt
   record (a fact: "landed, chain said not shipped", no reason vocabulary), or
   whether `TickContext` carries the entry's last merge outcome directly. Either
   widens an enumeration in spec/loop.md (*Prior-outcome feedback*) and
   spec/chain.md (*What a hook receives*), so it is the human's edit first; do
   not derive.
