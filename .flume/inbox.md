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

## 2026-09-07 — the tick's base sha is on no surface a gate or handoff reads (temper via flume-main)

1. **An afterMerge gate cannot tell an input the tick ignored from one it never
   saw.** Field-traced twice at temper this morning (~$11, 25 min): a trunk
   commit landed minutes after a plan tick branched; the afterMerge honesty gate
   reads trunk claims by design, saw an unreconciled input, and reverted a tick
   that could not have seen it. Chain-side fix at temper 0377962d reads the
   tick's own tree at `<FLUME_WORKTREES_DIR>/plan` HEAD — a path convention
   plus a cleanup-ordering promise the engine never made. Verified on disk: the
   dispatcher holds the span's base at both merge sites (`preWtHead` at
   `src/Dispatcher.ts:1896` for singleton, `r.spanBase` at `:2505` for fanout)
   and hands it out on neither `GateContext` (`src/Gate.ts`) nor `TickResult`
   (`src/Phase.ts`). With the base, a gate says `git show <base>:path` and
   `git log <base>..HEAD -- specs/` and never touches the worktree. Fact, not
   verdict: the engine reports where the span started; whether an input that
   post-dates it counts stays the chain's (`engineering.md`, *A fact the
   engine holds is reported, never rediscovered*). Candidate shape: `baseSha`
   beside `commitSha` on `GateContext` (both stages) and `TickResult`;
   `ShipContext` already carries the merged sha and would take the same field.
   Widens the enumerations in spec/chain.md (*What a gate receives*, *What a
   hook receives*) and spec/loop.md (*The tick verdict*), so the human's edit
   first. Temper also asked for the worktree path on the afterMerge
   `GateContext`; the base sha makes that read unnecessary, so file it only
   if plan finds a second consumer.
