# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **derive** — the only meaningful delta is the `spec:` commit `5c0b1c5` (§5/§6 reconciliation in `spec/RELEASE-v0.2.md`). No `build:` commit to audit (a `spec:` commit's audit *is* the re-derive); inbox empty (no drain); mechanical promote scan clean (no `blockedBy` points at an absent tag). Wrote pending.json + state.md; open-questions.md/inbox.md byte-unchanged.

## Derive — `5c0b1c5` (spec: reconcile §5/§6 — prior-outcome union channel)

Read the reconciled `spec/RELEASE-v0.2.md` in full (§1, §5, §6, §9, §12) and cross-checked against the shipped §5 surface in `src/`. The reconciliation turns §5 from gate-revert-only into a 3-variant **prior-outcome tagged union** (gate-revert | voluntary-bail | platform-preempt); §6 now owns *detect/classify* and explicitly mandates **widening §5's already-shipped surface in place** — gate-revert built in `22487fd`/`4cd0e68`, extend not rebuild, no shim (§12 + pre-1.0 clean-slate).

**Why the prior NO-COMMIT-TAXONOMY build tick produced no commit (now resolved):** the shipped `PriorAttempt` (`src/Prompt.ts:42`) + `<prior-attempt>` render (`prependPriorAttemptBlock`, `:192`) were gate-revert-only; routing voluntary-bail/platform-preempt (no commit, no gate) through that shape meant unilaterally redesigning a shipped contract — the build tick correctly bailed. The spec contradiction is reconciled; the entry is now executable.

**Re-derived `NO-COMMIT-TAXONOMY`** against reconciled §5/§6:
- **Added the missing `src/Prompt.ts`** to `files.edit` — the entry previously listed only `src/Dispatcher.ts`/`tests`, but `PriorAttempt` + the render block live in `src/Prompt.ts`. That omission *was* the wall: build either creeps off `entry.files` or under-delivers. Now explicit: widen the type → tagged union; render each variant distinctly; edit in place (keep the `PriorAttempt`/`<prior-attempt>` names per §6).
- `src/Dispatcher.ts` scope tightened to *detect voluntary-bail vs platform-preempt at tick level + classify on `TickOutcome` + persist via the existing buildPriorAttempt/writePriorAttempt path* — gate-revert write path already exists, extend not rebuild.
- `summary`/`notes` now point at §6's widen-in-place clause + §12's "extension, not rework-by-error" so build does not bail on the (now-removed) contradiction again. Stays one entry: the spec frames this as one in-place extension, not a split.

**Touched `RELEASE-0.2.0`** (pointer-accuracy only): the CHANGELOG `### Added` description restated the *old* §9 wording ("gate-failure prior-attempt context"); §9 now reads "prior-outcome context (gate-revert | voluntary-bail | platform-preempt) … (§5/§6)". Per field discipline a `description` is a pointer, not a restatement — shrunk it to "transcribe §9 verbatim", which also clears the staleness. `per`/`acceptance`/`notes` unchanged.

**Not done (deliberately):** no new §5 entry — §6/§12 explicitly forbid re-deriving the shipped gate-revert slice; NO-COMMIT-TAXONOMY carries the §5 widening. The §5 `prior-attempt` vs `prior-outcome` prose drift is not parked: §6's "widen in place, keep `PriorAttempt`" is the unambiguous resolution (conceptual name = prior-outcome; on-disk/render names stay `PriorAttempt`/`<prior-attempt>`) — a clear in-spec answer, not a human round-trip (collaboration *Inform before parking*). The §4/§7b/§8/§7a-docs chain is untouched by the §5/§6 reconciliation — those four entries are byte-stable.

## Promote — none

Mechanical scan of all `blockedBy` links: AFTERMERGE→NO-COMMIT-TAXONOMY, PLAN-PROSE→AFTERMERGE, WORKTREE→PLAN-PROSE, CHAIN-AUTHORING→WORKTREE, RELEASE→CHAIN-AUTHORING. Every cited tag is still present in the queue. No tag became absent → no flips.

## Queue (6 — one open head, then a linear chain)

`NO-COMMIT-TAXONOMY` (open, §6 — re-derived; next for build) → AFTERMERGE-REVERT-ISOLATION (§7b, heaviest) → PLAN-PROSE-DURABILITY (§8) → WORKTREE-RACE-SERIALIZE (§4) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9). §2/§3 runtime + the §5 gate-revert slice + the §3↔§5 composite test shipped (PER-TICK-CHAIN-RELOAD, LOOP-PROCESS-PER-TICK, CHAIN-AUTHORING-RELOAD-DOCS, CHAIN-LOAD-GATE, GATE-FAILURE-FEEDBACK, CHAINLOAD-FEEDBACK-TEST). NO-COMMIT-TAXONOMY now extends that §5 slice to the full union.

## Open questions

- **3**, all unchanged this tick. The §5/§6 reconciliation touches none of their surfaces; no human input arrived — not re-litigated (collaboration rule):
  1. §7a dogfood `.flume/chain.ts` gate-placement move — off build's writablePaths + builtin `when` affordance gap; gated on §7b (PARKED; rec A). Note still accurate: §5's block is structurally injected in `src/Prompt.ts` (build-writable), not a `.flume/prompts/*.md` token — the widened union stays build-writable, not parked here.
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — v0.2 rewrite still didn't fold it in (PARKED — NEEDS AMENDMENT; rec A).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A).

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` + `.flume/plan/state.md` (plan writable paths). open-questions.md + inbox.md byte-unchanged (no human input, empty queue). No off-allowlist path; all NO-COMMIT-TAXONOMY files (`src/Prompt.ts`, `src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) and RELEASE-0.2.0 files (`package.json`, `CHANGELOG.md`) are in build's code lane.
- Trunk: HEAD `5c0b1c5` (`spec:`). No code change this tick (plan-artifact-only).

Plan continues: no
