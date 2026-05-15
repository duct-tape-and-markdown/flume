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

## 2026-05-15 — verbose fanout wave logging (runner-review)

**Observation:** during fanout waves the harness goes silent for the duration of the cherry-pick loop, afterMerge gates, the `chore(flume): ship TAG` commit, and worktree cleanup. Per `src/Dispatcher.ts` `runFanout`, only failures log; success paths are silent. For an N-worktree wave the sequential cherry-pick loop dominates the silent lull. Erodes operator trust in autonomous loops because there's no signal between "fanout 4/12 pickable" and "build shipped TAG1,TAG2,..." — the gap can be many seconds with no indication anything is happening.

**Currently silent stages** (`src/Dispatcher.ts` `runFanout`):

| Stage                                              | Currently logs?           |
| -------------------------------------------------- | ------------------------- |
| Cherry-pick loop (sequential, one subprocess each) | failure only              |
| afterMerge gates                                   | failure only              |
| `chore(flume): ship TAG1,TAG2` commit              | silent                    |
| Worktree cleanup (parallel `git worktree remove`)  | failure only              |

**Proposed shape (~15-20 LOC in `src/Dispatcher.ts` `runFanout`):**

```
[flume] cherry-picking 3 commits onto trunk
[flume] cherry-pick STALE-COMMENTS-CLEANUP → a1b2c3d
[flume] cherry-pick HNSW-EF-SEARCH → e4f5g6h
[flume] cherry-pick MEMORY-PRUNE-PERF → i7j8k9l
[flume] updating pending.json (shipped: STALE-COMMENTS-CLEANUP, HNSW-EF-SEARCH, MEMORY-PRUNE-PERF)
[flume] cleaning 3 worktrees
[flume] wave complete in 8.4s
```

Same `[flume]` prefix as the existing `fanout N/M pickable in batch 1/M` line — rendering stays consistent.

**Pre-resolved scope decisions** (so plan doesn't re-litigate):

- Stage markers + total wave time only. No per-stage durations (over-engineering until markers prove insufficient).
- No CLI log-override via `chain.ts` mirroring agent — YAGNI; the default logger improvement is the whole win.
- Total wave time measured from start of cherry-pick loop to end of cleanup.

**Severity:** Low for correctness (existing failure logs cover must-know paths); High for ergonomics, especially as runner's wave size grows.

**Suggested routing:** pending entry against §3 CLI surface (closest existing fit) or §10 Non-goals (if plan decides this is v0.2 polish, accept as debt). v0.1 ship-prep is the natural cut — the dogfood loop benefits from this immediately, and runner picks it up on the next pin bump.
