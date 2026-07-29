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

## 2026-07-29 — concurrent supervisors on one tree: two commits eaten by dropLastCommit; pid guard bypassable, status blind to liveness (jeff pass, incident, owned)

Operator error with engine lessons. The pass relaunched a loop while
the prior batch's supervisor was still alive (PID lived 10:55→12:2x),
because (a) `flume status` read "hibernating" — it reads awake
MARKERS, not process liveness — and (b) the pass deleted a live
`loop.pid` on the "stale pid" assumption without a liveness check.
Two supervisors then shared one trunk tip: the stale supervisor's
revert path (dropLastCommit) fired twice on commits it did not own —
11:47:57 dropped `19be056` (its own false ship — coincidentally
correct), 12:04:59 dropped the operator's inbox commit `279bd8b`
(restored by cherry-pick). Reflog is the evidence. Asks, plan's
routing call: (1) loop startup refuses when loop.pid names a LIVE
process (liveness check, not file existence — the file alone invites
exactly this deletion); (2) `status` surfaces supervisor liveness
beside awake markers ("awake: build (supervisor pid 25616 LIVE)" /
"awake: build (no live supervisor — stale)") so the operator's
relaunch decision reads truth; (3) consider: dropLastCommit verifies
the tip commit is the one THIS supervisor created (sha remembered at
commit time) before dropping — refuses otherwise. S/S/M.
