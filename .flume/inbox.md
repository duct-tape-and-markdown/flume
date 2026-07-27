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

## 2026-07-27 — entry-scope revert discards the whole tick and eats its own evidence (human, from job dev-9175-cim-usage)

Field report, one fanout wave, two entries, both reverted for exactly one
undeclared path each — and both overruns were correct engineering (the
acceptance criteria were unsatisfiable inside the declared `files`; e.g. an
acceptance requiring a constant wired in from a file the entry didn't list).
The guard fired correctly; the cost model around it is the finding:

1. **The revert verdict does not survive to plan.** The offending path list
   and the agent's own explanation (one wrote "outside entry.files, noted in
   commit body + friction log" — then everything reverted) lived only in
   supervisor stdout and the fanout worktree, which cleanup deleted. Plan
   re-scoped from the operator's inbox note, not from the agents' evidence.
   Engine ask: on an entry-scope revert, persist the offending paths + the
   reverted commit's message somewhere plan reads — e.g. append to the
   entry's `gate.reason` in pending.json. Related to parked engine request
   #2 (plan-time path pre-check): same law, this is its post-hoc half.
2. **Wholesale discard is the right guarantee, expensive mechanism.** ~7 min
   of agent work discarded per entry over 1 path out of a dozen touched.
   Bigger design: revert only offending paths, or stash the full diff and
   hand it to the retry. Preserve the per-entry narrowing itself — it's what
   keeps concurrent fanout entries from colliding.

Chain-side mitigations exist and shipped to the personal template
(flume-template `5b94b3c`): build prompt's needs-rescope discipline
(channel-only commit when acceptance exceeds `files` — note a friction write
inside the doomed commit dies WITH the revert; only a channel-only commit
survives), plan prompt's acceptance-vs-files cross-check, and
`entryChannelPaths` declared so the escape hatch exists. Engine items above
are what chains cannot do for themselves.

**Addendum (operator, same day):** friction being gitignored is intentional
design — the loop-to-owner channel, hand-routed, never in a commit diff —
and any fix must preserve that. The missing piece is narrower than item 1
first framed it: the engine owns fanout worktree TEARDOWN, and teardown
deletes friction before the owner can route it. Candidate shape: at
worktree removal, harvest `<worktree state root>/friction/*` (and on an
entry-scope revert, the offending-path list + reverted commit message) back
to the primary state root — evidence survives with zero commit-stream
change. Note this lives in the SAME teardown code path as the win32
cleanup failure below: one visit fixes both.

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
