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

## 2026-08-01 — win32 path-limit sweep failed on real Windows; loop has no win32 oracle (operator)

CI run 30680281416 (windows job), first run containing the 7-entry
WIN32-PATH-TOTAL-LIMIT sweep: ~8 test failures, INCLUDING the sweep's own
new win32-targeted tests (WORKTREE fresh-create, PRIORATTEMPT round-trip,
SNAPSHOTREVERTEDFILES both legs, REMOVEWORKTREE fallback). The prior two
known failures (revert-note ENOENT, tip-claim SIGTERM) also persist.

Root observation, more important than any one failure: build gates run on
Linux, where win32 path semantics cannot execute — win32 assertions ship
green locally and fail on real Windows. Do NOT re-derive another blind
win32 fix wave; the same oracle gap produces the same outcome.

Route as: park an open question for the operator on the verification
strategy before any further win32 entries. Candidate strategies to name
in the question: (a) win32-gated tests (`skipIf(!win32)`) so local green
is honest, with CI as the only executor and a human-in-the-loop on the
red/green signal; (b) run the suite under Windows node from the WSL host
interactively to close the loop locally; (c) a CI-feedback channel
(fetch the windows job's failures into the inbox mechanically). Any
in-flight or newly-derived win32 entries should be blocked on that
question.
