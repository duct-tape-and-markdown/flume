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

## 2026-08-05 — incident: worktree tick dirtied the trunk's open-questions.md; cherry-pick spun without a brake (human + interactive session, observed live)

During the 6th DEADDECL-LOAD-REFUSAL build tick, the agent wrote its re-park
note to **both** its worktree's `.flume/plan/open-questions.md` (committed,
orphaned `dcc384d`) and the trunk checkout's copy (left uncommitted —
verified byte-identical hunks). The dispatcher's cherry-pick then refused on
the dirty trunk and kept the entry pending — the loud refusal is correct —
but the loop entered a paid spin: every iteration re-parked the same blocked
entry and re-failed the same cherry-pick (~$0.75/tick, observed through
tick 7 before the operator killed the loop). Two seams:

1. **Chain/prompt side — the double write.** How does a worktree tick reach
   the trunk's copy of a state file? Suspect: an absolute state-root path
   (FLUME_DIR-anchored) used for one write and worktree-relative for
   another. The 7th tick repeated the pattern
   (`Edit(.flume/plan/open-questions.md)` was its last action before the
   kill). Needs diagnosis at the park-file instruction seam
   (`.flume/chain.ts` PARK_FILE / `prompts/build.md`); the fix likely pins
   which resolution the park write uses.
2. **Engine side — no repeated-failure brake at the merge stage.**
   Provisioning failures get consecutive-identical-signature accounting and
   an abort (`supervisorPolicy.abortThreshold`); an identical cherry-pick
   failure repeating every iteration gets none, so the loop burns one full
   agent invocation per lap indefinitely. Same policy shape, different
   stage — worth asking whether the abort accounting belongs on failure
   signatures generally rather than provisioning's alone
   (`spec/loop.md` / `src/Dispatcher.ts:superviseLoop`).

Context: the blocking entry itself is unblocked separately
(`scopeWritesToEntry: true` landed interactively); this entry is about the
failure shape, which survives that fix.
