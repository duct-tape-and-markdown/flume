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

## 2026-07-27 — engine requests from centercode-platform's chain (human)

Four requests surfaced from centercode-platform PR #670's subtraction (chain code removed in favor of engine-level enforcement). Each is "the engine owns this truth, so the engine should enforce it" — not chain code looking for a new home.

1. **Engine validates pending.json against its own schema on plan commit.** Flume defines the pending format and exports `parsePending`; today every responsible chain must hand-roll an afterCommit gate that calls the engine's own parser back at it (~30 lines per chain). The engine should refuse a plan commit whose pending.json does not parse against its own schema. Evidence: centercode-platform's `pendingParseGate` caught a real malformed-pending revert in the 2026-07-24 rehearsal (tick-1).

2. **Engine pre-checks planned entry paths against the next phase's writablePaths.** The engine owns both sides of this law — the pending entry format AND writablePaths fence enforcement at build. Chains that want plan-time failure must re-implement glob matching, which can silently diverge from the engine's semantics (centercode-platform carried a second glob matcher for exactly this until 2026-07-27, then cut it). One matcher, one truth: at plan commit, any pickable entry naming a path outside the next phase's fence fails the tick with the offending paths listed. Every chain gets one-tick-earlier failure for free.

3. **GateContext exposes the repo/worktree root.** Gates that shell out to build tools need the worktree root; today they run `git rev-parse --show-toplevel` themselves with a fallback (centercode-platform's `repoRootOf`, `dotnet-build` gate). `ctx.repoRoot` kills the helper in every chain.

4. **A tick that throws does not stop the loop, and `flume job run` exits 0 regardless.** Observed in the centercode-platform pilot (2026-07-27): the chain module failed to load (ENOENT), every tick died at spawn — supervisor logged `tick process exited with code 1; supervisor continuing (next tick is a fresh process)` — and the run still completed with exit 0. On a long `--max`, a job that can never load burns every tick and reports success at the command level. The engine owns loop supervision and the process exit code: a chain that cannot LOAD should halt the run, and `job run` should propagate a non-zero exit when it shipped nothing because ticks failed. Distinguish "ticks ran and the plan settled" (0) from "ticks could not run" (non-zero).
