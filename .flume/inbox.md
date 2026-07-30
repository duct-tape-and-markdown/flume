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

## 2026-07-30 — bail park notes die with the worktree; SPLIT entry needs an operator-coordinated ship (operator)

Two findings from the v0.8 wave's final tick (PENDING-SCHEMA-CORE-EXTENSION-SPLIT, voluntary-bail, no commit — session log, 17-tick run ending eae4182):

1. **Park notes are lost on voluntary bail.** The tick wrote its park into `open-questions.md` inside the fanout worktree, bailed without committing, and worktree cleanup destroyed the note. v0.7 §13's footprint machinery covers gate-reverts only; a voluntary bail with uncommitted channel edits leaves zero trace on trunk. The §15 wake is now wired (c8ccfd2), so plan wakes on bail — but still cannot see *why*. Candidate directions: dispatcher salvages channel-path edits from the worktree on voluntary-bail (landing them as the park commit §12 already declines to classify as shipped), or the build prompt instructs committing the park before bailing. Apply the engine-boundary lens when routing.

2. **Reconstructed bail reason:** the schema split cannot ship from a build tick at all — the dogfood `.flume/chain.ts` must declare its entry extension in the same commit (CLAUDE.md: breaking runtime changes update chain.ts atomically; without the declaration, existing `pending.json` fails the core-only schema at `pendingParseGate` and the tick reverts). chain.ts is off-fence for build ⇒ v0.8 §2 is an **operator-coordinated ship**: the whole entry, not a trailing leg — larger than the §11/§13/§15 class. Route PENDING-SCHEMA-CORE-EXTENSION-SPLIT to an operator disposition, and check whether TAG-GRAMMAR-MECHANICAL-SAFETY and PENDING-GATE-BUILTIN (blockedBy it) inherit the same coordination need for their dogfood-refinement legs.
