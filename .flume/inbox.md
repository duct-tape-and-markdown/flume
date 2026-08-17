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


## 2026-08-17 — decline/bail livelock: plan's shouldRun can never reconcile an open entry whose acceptance already holds (session, live run)

Observed live: buildpriorattempt-tail-bias-gate-revert-details' work landed via the
verdict-sha recovery flow (out-of-band cherry-pick), leaving the entry open in committed
pending.json. Plan's `shouldRun` (chain.ts ~358) returns true only when nothing is pickable
or the inbox has entries — so a pickable entry defers plan to build forever, build's agent
correctly voluntary-bails ("acceptance already holds") forever, and a voluntary bail carries
no failure signature so the quarantine brake never fires (the incident-6 observation, new
shape). Two decline/bail cycles burned (~75-405s each) before `flume stop` capped the run —
first live use of the stop flag, worked as specced. This inbox entry is itself the designed
unblock: inboxHasEntries() now gives plan the turn it needs to reconcile the entry out.

Proposed chain fix (chain.ts is the operator's lane, so proposing rather than editing
mid-run): plan's shouldRun also returns true when any pickable entry carries a
voluntary-bail prior-attempt record — build has already said "I looked; this is plan's
call"; a cheap existence/mode check on <flumeDir>/prior-attempts/<slug>.json matches the
predicate's read-small-files idiom. Alternative at the same seam: the dal-migration friction
note's pre-dispatch acceptance check (incident 14), which prevents the dispatch instead of
recovering from it — but that one needs the semantic-acceptance design question answered
first; the shouldRun tweak needs nothing and bounds the class (any bailed entry gets plan's
attention next tick, whatever the bail reason).
