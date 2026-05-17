# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the only substantive delta dimension is the `build:` commit `bd5e6f4` (AFTERMERGE-REVERT-ISOLATION, §7b), shipped by `b58974d`. No spec delta; inbox empty. Promote also fired (mechanical — AFTERMERGE-REVERT-ISOLATION shipped → PLAN-PROSE-DURABILITY unblocked).

## Audit — `bd5e6f4` (build: isolate afterMerge revert to the offending entry §7b) vs §7b

Cross-checked the full diff (`src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) against `spec/RELEASE-v0.2.md` §7(b) + §10 + §12. Trunk green: 88 tests pass, `pnpm tsc --noEmit` clean.

**Conformant.** The cherry-pick loop and the afterMerge-gate loop are fused into one per-entry pass: `preCherry = revParse` → `cherryPick` → `mergedSha = revParse` → run `afterMergeGates` against `mergedSha` → on failure `buildPriorAttempt`/`writePriorAttempt` (digest captured *before* reset, SHA still reachable) then `hardResetTo(preCherry)` and the entry stays pending; else `shipped.push`. The whole-wave `hardResetTo(preHead)` blast radius is gone — only the offending entry's commit reverts; N−1 clean siblings already on trunk stay; later siblings are evaluated against the trunk without the reverted commit. `preHead` still live (createWorktree arg) — no dead var. Files == `entry.files` exactly (no scope creep); `schemaDelta: none` correct. The plan-flagged coupled re-derive landed: `waveNoCommit`'s `!waveOk && shipped.length>0 → gate-revert` branch is replaced by `mergeReverted.length>0`, and `committedWave`/`shippedTags` drop the dead `waveOk` gate (the prior tick's Finding-2 cross-tick pointer, acted on). Order-independent attribution: the offending entry is the sole delta between `preCherry` and `mergedSha` regardless of `perEntry` order — the §7b test's file-presence gate verifies this both ways. Wave-level `noCommit` precedence is the same accepted debt as the prior audit (per-entry §5 record is the mandated channel; written for every merge-reverted entry — test-verified via `failPrompts[1]`).

**Finding (accepted debt + cross-tick pointer → WORKTREE-RACE-SERIALIZE).** Spec §4 and §7's acceptance both cite "the existing fanout-parallelism assertion" as a shared canary. No such standalone assertion existed pre-`bd5e6f4` (`git show bd5e6f4~1:tests/Dispatcher.test.ts` has zero `maxInFlight`/in-flight/concurrent tracking). The build did the right thing — it *created* the missing coverage by folding a `maxInFlight===2` probe over the agent-fanout `Promise.all` into the rewritten §7b test, which is a *functional* §4 canary (it asserts on the exact `Promise.all` §4 must keep parallel). But it is fragile *by location*: the §4 regression signal now lives inside a complex multi-tick afterMerge-revert test, not a standalone one. Not an OQ (mechanism is build's per §4/§7 acceptance, no human input needed) and not a new entry (no new shippable unit). Routed by refining WORKTREE-RACE-SERIALIZE's `files`/`tests`/`acceptance`/`notes` to point its build tick at the real canary (`§7b test, maxInFlight===2`) so it asserts against that instead of hunting a phantom standalone test or weakening the canary. Stale spec line numbers (§4 :257/:284/:353 are pre-reload) folded into the same notes refresh.

## Promote — PLAN-PROSE-DURABILITY → open

Mechanical scan of all `blockedBy`: PLAN-PROSE-DURABILITY→AFTERMERGE-REVERT-ISOLATION (tag absent from queue — shipped by `b58974d`) → **flipped to `{kind:"open"}`**. Remaining links all still resolve: WORKTREE→PLAN-PROSE, BAIL-CONSTRAINT→WORKTREE, CHAIN-AUTHORING→BAIL-CONSTRAINT, RELEASE→CHAIN-AUTHORING. No other flips.

## Queue (5 — one open head, then a linear chain)

`PLAN-PROSE-DURABILITY` (open, §8 — next for build) → WORKTREE-RACE-SERIALIZE (§4) → BAIL-CONSTRAINT-LEGIBILITY (§5 audit follow-up) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9). §2/§3 runtime + the full §5/§6 prior-outcome union + §7b afterMerge isolation all shipped.

## Open questions

- **3.** OQ#1 (§7a dogfood chain.ts gate-move) got a factual status bump — its "must land after §7b ships" precondition is now satisfied (§7b shipped `bd5e6f4`/`b58974d`); remaining blockers (off-allowlist edit + builtin `when` affordance gap) unchanged, still human/`chore(flume):` lane. Not re-litigated (no human input arrived). OQ#2 (unspecced `teardownWorktree`/`WorktreeSetupResult`/`extraEnv` surface — NEEDS AMENDMENT) and OQ#3 (`v0.1.1` tag vs CHANGELOG) untouched by this delta — byte-unchanged.

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` + `.flume/plan/state.md` + `.flume/plan/open-questions.md` (plan writable paths). inbox.md byte-unchanged (empty queue, no human input). No off-allowlist path filed; the audit finding routed entirely into WORKTREE-RACE-SERIALIZE's plan-owned fields.
- Trunk: HEAD `b58974d` (`chore(flume):` ship). No code change this tick (plan-artifact-only).

Plan continues: no
