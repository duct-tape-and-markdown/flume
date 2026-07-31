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

## 2026-07-31 — CHAIN-AUTHORING recipe candidate: worktree provisioning belongs to the repo; document the setupWorktree pattern (pass)

Docs-only suggestion, low severity. An earlier draft of this entry asked
for an engine-level provisioning member with engine-owned serialization —
withdrawn before filing settled: that shape is the engine absorbing
convention, the exact class the v0.11 boundary line removes. The
`setupWorktree` hook is already the right and sufficient seam; the engine
provides the mechanism, the chain owns the policy, and the provisioning
act itself is repo knowledge.

What might be worth a CHAIN-AUTHORING recipe (documentation, not
machinery, per the v0.9/v0.11 posture): a fresh fanout worktree carries no
gitignored build inputs, and provisioning acts that touch a shared cold
cache are not concurrency-safe across the dispatcher's parallel setups
(Dispatcher.ts:1215 runs the wave's setups in one Promise.all). The proven
pattern (centercode-platform PR #688, head `11c44b799e`):

- the repo owns a provisioning unit (script owning the what — e.g. the
  solution list for `dotnet restore`); the chain's `setupWorktree` is a
  thin caller owning only the when;
- calls serialize across the wave through a module-level promise queue
  whose stored tail swallows rejections, so one failed setup cannot
  poison the setups queued behind it (NuGet's user-level cache collides
  when cold; the repo's own CI serializes restores for the same reason);
- a failed setup fails loudly with the unit's own error, because a build
  gate failing later looks nothing like the cause.

Route as: a short recipe/paragraph in CHAIN-AUTHORING's setupWorktree
section, or accept-as-debt if the doc already implies it. No engine code
implicated.

Revisit trigger (evidence-gated, v0.9 posture): if a SECOND bay hand-rolls
the same serialization queue, the second-implementation test fires the
other way and a chain-declared setup-scheduling knob (chain supplies
policy, dispatcher supplies enforcement) becomes a capability worth an
engine entry — the dispatcher already serializes worktree creation for the
same shared-mutable-state reason (Dispatcher.ts:1180). Until then, recipe
only.
