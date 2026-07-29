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

## 2026-07-29 — supervisor burned 12/16 ticks on one deterministic pre-tick failure (jeff pass, live batch)

Batch 3 of the v0.7 loop: `git worktree` sweep of
`.flume/worktrees/ship-detection-declared-files-diff` failed EBUSY
(rmdir; dir held by an editor's tsserver/watcher — external
handle-holder, win32), every subsequent tick re-hit the identical
wall, each exited 1, supervisor logged "continuing (next tick is a
fresh process)" twelve times until --max. §4's mount-dead clause
("does not burn the remaining --max ticks re-hitting the same wall")
names the principle but scopes only the load/mount class — a
pre-tick environment failure (worktree provision/sweep) is a distinct
class with the same burn shape. Observed additionally: delete AND
rename of the held dir are both denied while a watcher holds it, so a
rename-aside fallback would not have rescued this case; the dir being
EMPTY-but-held is the end state. Options seen from outside (plan's
call): consecutive-identical-failure abort/backoff at the supervisor;
per-entry provision-failure quarantine (skip that entry's slug for
the batch, work other entries — 6 other queue entries were workable
the whole time). Evidence: .flume/loop-20260729.log tail, 12x EBUSY
traces. M.
