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

## 2026-09-03 — 0.13 feedback round: issue routing and non-spec items (human)

The 0.13 spec delta (spec/pending.md, loop.md, chain.md, prompt.md, worktrees.md,
this commit) answers the open GitHub issues below. Derive from the spec as usual;
this note only maps entries to the issues they close, so the ship commit bodies
can cite them and the operator can close them at the cut.

- gh#15 `blockedBy.tags` — spec/pending.md *The entry core*, *Pickability*, *Wave
  auto-unblock*. Breaking schema change; single-tag form is gone (pre-1.0 clean slate).
- gh#16 `supervisorPolicy.partitionIgnore` — spec/pending.md *Fanout partition*,
  spec/chain.md *Supervisor policy*.
- gh#17 §3 harvest duplicate — spec/worktrees.md *Teardown harvest*. gh#17 §1 and §2
  need no engine change: spec/chain.md *Gate placement* now states the wave case and
  the chain-side channel-only wrapper; docs answer only, no entry.
- gh#10 + gh#12 verdict `headSha`/`at`/`invocations[]` + `readLatestVerdictsSync` —
  spec/loop.md *The tick verdict*.
- gh#11 `slugify`/`priorAttemptPath` export + record `headSha`/`at` — spec/pending.md
  *What the package exports*, spec/loop.md *Prior-outcome feedback*.
- gh#9 `Gate.command` rendered in `<harness>` — spec/chain.md *The builtin gates*,
  spec/prompt.md *The harness block*.
- inbox 2026-08-26 (temper live-lock) `TickResult.quarantinedTags` + `nothingPickable`
  — spec/loop.md *The no-commit taxonomy*, spec/pending.md *Pickability*.
- Ratified 2026-08-18 (git log 271fb13), now spec'd: `failingFiles` — spec/chain.md
  *What a gate returns*, spec/loop.md *Prior-outcome feedback*; cherry-pick abort
  bystander fix — spec/loop.md *Crash equals stop*.
- Ratified 2026-08-18, no spec home (internal refactor), file directly: the cli.ts /
  tests/cli.test.ts split along the four seams named in 271fb13's answer (help text,
  state/job resolution, verdict formatting, job-verb dispatch; `main()`'s argv switch
  stays). Sequence it last in the line — pure churn, no consumer-facing change.
- gh#13 + two more stale-doc sites, docs lane, one entry: `GateContext.repoRoot` JSDoc
  and the `GatePhase` "singleton phases never run afterMerge" comment in src/Gate.ts
  predate 0.12 singleton worktrees; docs/CLI.md ~121 "will not appear" misses the
  gitignored job state that survives a branch switch; README.md:196 heading
  "Relocating fanout worktrees only" — singleton worktrees ride the same base.
- Out of this line, tracked on GitHub only: gh#14 (agent-authored handoff signal),
  gh#8 (intake gate), gh#18 (entry identity vs brief heading) — design sessions.

- observed 2026-08-26 (temper's dogfood chain, @dtmd/flume 0.12.0) — a
  quarantined entry live-locks the loop's tail: after a gate-revert
  quarantines the wave's only open entry, the chain's build handoff still
  sees it as `gate.kind === "open"` in `pendingAfter` (quarantine is
  supervisor-internal, invisible to the chain) and hands back to build;
  the next tick's "nothing pickable" path then keeps the phase awake
  without consulting handoff, so the run burns no-op ticks to `--max`
  (twice reproduced: 50-tick runs ending "nothing pickable" x N,
  exit 0). Ask: either surface quarantine state on `pendingAfter`
  entries so a chain can exclude them, or make the nothing-pickable
  no-commit tick run the phase handoff (or hibernate) instead of
  re-waking the same phase. Repro: temper repo, tick-verdicts around
  COVERAGE-EMBEDDED-COUNT-MARKER's afterMerge-revert, 2026-08-26.
