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

## 2026-09-03 — pendingGate judges the previous commit, not the gated one (human)

`pendingGate` reads `join(ctx.flumeDir, pendingPath)` (`src/builtinGates.ts:347`) —
the primary checkout's queue — while running as an `afterCommit` gate inside the
singleton worktree. Since 0.12 the plan tick's commit lives in that worktree, so the
gate always judges **trunk's** `pending.json`, i.e. the previous plan commit's, and
never the one it is gating. Correct pre-0.12 (singleton committed straight to trunk,
so the two files were one); a code-side instance of the singleton-worktree model
shift the docs bundle just corrected in prose.

Observed this run, tick-verdicts.jsonl around 22:41–22:50:
- 70f4632 filed `PRIOR-ATTEMPTS-DIR-EXPORT` declaring `.flume/chain.ts` (off every
  fence). Its pending-gate passed with "plan/pending.json valid (0 entries), fence
  pre-check passed" — green over zero entries on a commit that added one
  (engineering.md "A green verdict is proven non-vacuous").
- c168d3b, the next plan tick, correctly dropped the path and parked the chain
  wiring; the gate read trunk's still-bad file and reverted the fix. The entry was
  quarantined and the run hibernated (the new `quarantinedTags` path — no livelock).
  The reverted tick is restored to trunk by the commit carrying this note.

Consequence: a plan tick can never repair an off-fence entry, because every repair
is judged against the state it repairs — the failure signature repeats identically
and the backstop aborts. spec/pending.md "`pendingGate`" promises the check "fails
here, at the producer's own commit"; the code fails one commit late.

Fix at the mechanism: read the queue **from the gated commit**, the way
`writablePathsGate` reads touched paths from `ctx.commitSha` — `git show
<commitSha>:<repo-relative pendingPath>` in `ctx.cwd`, or the worktree's checkout of
the state root's repo-relative mirror (the same mirror `harvestFriction` resolves).
The relocated-state-root case (`FLUME_DIR` outside the repo, queue invisible to git,
spec/pending.md "Wave auto-unblock") keeps the `flumeDir` read — that is the only
case where it is right. Ships with a test that fails on the pre-fix tree: a plan
commit adding an off-fence entry to an in-repo queue is reverted by *that* commit's
gate, and a commit removing one is not.
