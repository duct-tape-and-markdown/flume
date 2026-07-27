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

## 2026-07-27 — win32 worktree cleanup fails every wave (human)

All three build waves of the v0.6.1 run ended with `worktree cleanup failed …
Command failed: git worktree remove --force <dir>` / `error: failed to delete
… Directory not empty`, leaving `node_modules`-laden dirs under
`.flume/worktrees/` (swept by hand after the run). Likely cause: on Windows,
`git worktree remove --force` won't delete a dir tree containing files git
never tracked at that scale (or locked handles); pnpm-installed node_modules
qualifies. Loop completed fine otherwise — severity is disk-bloat +
noise-per-wave, not correctness. Candidate fix lives with setupWorktree's
owner: engine falls back to `git worktree prune` + recursive rm when
`worktree remove` fails, or documents that chains owning setupWorktree also
own teardown.
