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

## 2026-09-03 — three field observations from temper's 0.12 release round (temper-2d via human)

Filed after the 0.13.0 cut commit; next-line scope. Source: temper's dogfood chain,
~25 build ticks, 14 entries shipped on @dtmd/flume 0.12.0.

1. **A per-entry voluntary bail is invisible on a wave that also shipped.**
   `TickResult.noCommit` is the wave's one representative cause and is absent when any
   entry shipped, so a chain whose build handoff chains build-to-build on open entries
   never routes to plan for the bail — the bailed entry is re-picked with its capture
   undrained (one entry bailed three times on the same known gap, ~$0.5 each). Same
   class as `quarantinedTags`: a fact the engine holds per entry (each record's mode)
   and hands out only as a wave fold. Ask at the fact level: per-entry no-commit modes
   on `TickResult` (`bailedTags`, or an entries[] with mode) — the wake stays the
   chain's (`engineering.md`, *A fact the engine holds is reported*). Whether
   prior-attempts should block a re-pick is chain policy (`shouldRun`); flume's own
   chain does it on plan's side.

2. **Quarantine survives a re-scope.** The run-scoped quarantine is keyed by slug, so
   an operator's re-scope commit on trunk does not lift it; the fix is stop and
   relaunch. Ask: key the quarantine on the entry as read (slug + a hash of the entry
   content, or the sha the entry was read at) so a changed entry is a new key, and
   report the key on `quarantinedTags`' companion so a chain can see why it stands.
   Engine-computed from `pending.json`, nothing inferred.

3. **A supervisor killed mid-merge leaves a cherry-picked commit on trunk with no
   afterMerge gates and no ship bookkeeping.** Happened once (background task killed
   during a wave's merge stage). Recovery was manual — run every afterMerge gate from
   chain.ts by hand, then the ledger rewrite — and a gate was missed on the first
   pass. This is a hole in `spec/loop.md` *Crash equals stop*: the guarantee covers
   the worktree side but a commit already on trunk past the last verdict's `headSha`
   is neither gated nor recorded. Ask: a startup check under the tip claim that
   notices trunk commits past the last verdict with no ship row and refuses (or a
   `flume resume-merge` that finishes the gates + bookkeeping from the verdict's span
   shas — the same recovery idiom the verdict's `headSha` exists for). Needs a spec
   edit before derivation; the operator will open it. Filed as **gh#19** with the
   repro: kill landed after the first `cherry-picked <TAG> → <sha>` line and before
   `ship commit`; no verdict row at all for the tick (last row's `headSha` predates
   the trunk commit); `pending.json` still listed the entry open, so the next run
   would have re-picked and double-cherry-picked; four worktrees left behind, no
   lock or pid. Boundary note for the spec edit: the issue's "not operator commits"
   framing is an inference the engine must not make (`engine-boundary.md`, *Told,
   not inferred*) — the durable evidence is the surviving `flume/<slug>` branch
   whose tip the trunk commit was picked from (teardown never ran), plus the
   worktree dirs the startup sweep already enumerates. Detect from those, never
   from commit shape or author.
