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

## 2026-09-07 — three findings from the first Opus run (interactive session via human)

1. **A build park cannot reach plan; the loop livelocks on it.** FLUMEAPI-PATHS
   was parked four times (06b6f32, 71c29d5, 266d80c landed; c60e8db reverted by
   a flaky gate) with the same verdict each time: the entry's `files.edit` fence
   is three files and the change needs nine call sites across `src/cli.ts`,
   `src/cliJobVerbs.ts`, `src/job.ts`, `src/builtinGates.ts` — only plan can
   widen it. Plan never ran: a park is a commit that passes gates, the entry
   stays pickable, and `plan.shouldRun` (`.flume/chain.ts`) returns false
   whenever anything is pickable unless a voluntary-bail record or an inbox
   entry exists. `build.handoff` wakes plan on the gate results, so the wake
   happens and the decline follows. The engine's channel for this exists —
   `Phase.shipped` and the `not-shipped` merge outcome (spec/pending.md, *Ship
   detection trusts the agent's own account*) — and the dogfood chain declares
   neither; the park protocol is prompt-only. Ruling needed on the chain's park
   protocol: how a build agent states a park (a fact the chain's `shipped`
   predicate reads), and `plan.shouldRun` keying on that verdict rather than on
   pickability. Chain-side; no engine entry. Until then the operator restores
   the park text and runs plan by hand.
2. **The afterMerge `vitest` gate reverted a docs-only commit under host
   contention.** c60e8db touched only `.flume/plan/open-questions.md`; the gate
   ran the suite while a sibling loop held six cargo/rustc processes, transform
   ran 7× slower than quiet (37s vs 6.6s), two singleton-worktree tests hit their
   8s timeout, and the park was lost. Chain fix landed in the same commit as this
   note: the gate is scoped to commits touching code paths, declared at the site.
   Engine-side residue to weigh: a gate has no way to say "not applicable" that
   the verdict distinguishes from green (`GateResult` is ok/not-ok), so the skip
   is reported as a green with a message. `engineering.md`, *A green verdict is
   proven non-vacuous*.
3. **The prior-attempt `details` digest drops the failing test names.** `bound`
   keeps the head, `boundTail` the tail; the afterMerge vitest digest kept the
   tail, which for a long suite is the pass list and the count line, while the
   `×` lines sit in the elided head. Four of today's records (`flumeapi-paths`
   attempts 1–2, `aftermerge-revert-tip-check`, `tickcontext-pickable-…`) carried
   a count and no name, and the reverted park at c60e8db records the retry agent
   diagnosing from that gap. Fix shape: the digest keeps the failure block
   (vitest's `Failed Tests` section, or any `×`/`FAIL` lines) before it keeps
   anything else. `engineering.md`, *A fact the engine holds is reported*.
