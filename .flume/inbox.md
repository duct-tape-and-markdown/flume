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

## 2026-08-05 — defect: fanout collector orphans a multi-commit entry as "tip moved (no commit)" (downstream report, temper bay @ 0.10.1 win11; verified interactively against src)

Downstream incident, full report on file with the operator: a 3-entry wave,
all agents completed; one entry — whose recovered commit sits exactly on the
wave's recorded base — was classified `tip moved (no commit)`, soft-reset,
its worktree torn down, the entry left `open` for a blind re-run. ~$6 of
gate-worthy work survived only as a dangling sha. No gate ran; the verdict
carries no mergeOutcome for the entry — a dropped commit and a parked entry
are indistinguishable at every operator surface.

**Verified mechanism** (`src/Dispatcher.ts`): the fanout collection path
(`:2286-2305`) routes agent commits through `checkTipMoved` (`:2435-2436`),
which is a **parent-equality** check: `revParse(postHead^) !== preHead` →
refuse and revert the whole span. In a private entry worktree, any agent
that commits and then commits again — a tidy-up, a test fix — trips it. The
callsite's own comment (`:2292-2294`) states the branch is private to the
entry/tick, then draws the equality conclusion anyway.

**Refinement over the report:** the reporter believed the agent made exactly
one commit. The log line prints `found <postHead^>` — the *parent* of the
observed HEAD — so the "found" sha (`17a9f89`, the recovered work) implies a
second commit sat above it at collection (consistent with the captured
post-commit `rm` of two committed-then-rejected scratch files). The message
never prints `postHead` itself, so the top commit's sha is undiscoverable
from the log — the operator recovered the parent and lost the tip of their
own span.

**Spec already amended** (`spec/loop.md`, *Tip verify* — per-leg split, this
session): the per-entry leg's check is **ancestry of the recorded base**,
N agent commits are a completed entry whose whole span gates and
cherry-picks; refusal (non-descent only) must name both shas and land in the
verdict as a dropped-work merge-outcome fact. The singleton trunk leg keeps
parent equality and the declared full-span trade — its ambiguity premise
holds there and only there.

For the fix's test (per "a fix ships the test that would have caught it"):
the reduced repro is a fanout entry worktree at base B where the agent
commits C1 then C2 (both descending from B) — pre-fix trees classify
tip-moved and revert; post-fix the entry gates and ships the span. The
refusal case: rewrite the worktree branch to a commit not descending from B
— assert both shas in the message and the dropped-work verdict fact.
