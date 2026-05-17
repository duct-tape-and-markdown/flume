# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the substantive delta is the `build:` commit `85b0539` (PLAN-PROSE-DURABILITY, §8), shipped by `b569104`. No spec delta; inbox empty. Promote also fired (mechanical — PLAN-PROSE-DURABILITY shipped → WORKTREE-RACE-SERIALIZE unblocked).

## Audit — `85b0539` (build: snapshot a gate-reverted singleton commit's files for §8 prose durability) vs §8

Cross-checked the full diff (`src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) against `spec/RELEASE-v0.2.md` §8 + §9 + §12. Trunk green: `pnpm tsc --noEmit` exit 0, 89 tests pass (8 files), the §7b `maxInFlight===2` canary and the new §8 test included.

**Conformant.** Mechanism: before the `git reset --hard`, `snapshotRevertedFiles(cwd, postHead, key)` (Dispatcher.ts:445, inside `runSingleton` 399–480) `git show`s every non-deleted file the reverted commit touched and writes verbatim post-image content under `.flume/prior-attempts/<key>.reverted/<repo-rel-path>`. Recovery is "open the file", no session logs.

- **Spec-licensed mechanism choice (borderline, recorded so the disposition is defensible).** The durable snapshot is a *third* mechanism, not literally one of §8's two enumerated ones (scoped revert / §5-carry). §8 explicitly delegates: "the spec mandates the property (no silent prose loss), not the implementation," and its acceptance is "recoverable without session logs: **present on disk** OR in the next plan tick's prior-attempt block." The snapshot satisfies "present on disk" + "no session logs" — conformant. Not an OQ (mechanism is build's by spec; no human input needed); narrative-only disposition in this `plan:` body.
- **Files == entry.files exactly.** `src/Dispatcher.ts` + `tests/Dispatcher.test.ts`, both `edit`. No scope creep. `.flume/prior-attempts/` is already gitignored (`.gitignore:7`) — no `.gitignore` edit needed; build correctly left it. The snapshot is a *runtime* write to a gitignored, build-non-writable path, never committed (test scopes the agent commit to `.flume/plan`).
- **Control flow correct.** Snapshot runs while `postHead` is still reachable, *before* `git.dropLastCommit` (446); `cwd === repoRoot` for singleton so `git show` targets the right repo. `priorAttemptPath` (`<key>.json`, §5) and `revertedSnapshotDir` (`<key>.reverted`, §8) share `repoRoot`/`PRIOR_ATTEMPTS_DIR` → equal durability past `git reset --hard` and worktree teardown.
- **Scoped to runSingleton** as the commit body claims. Fanout's `clearPriorAttempt` (663) also `rm`s the reverted dir — harmless no-op (fanout never creates a snapshot).
- **No-false-signal invariant preserved.** Clean-ship `clearPriorAttempt` (459) removes the snapshot dir too; `snapshotRevertedFiles` `rm`s a stale snapshot under the same key before re-writing. Test-verified (2nd clean tick → `existsSync(snapDir)` false). Best-effort honored: snapshot in try/catch with empty body — failure never blocks/fails the revert; a failed snapshot leaves the dir absent (no false recovery signal), per §8 "property, not a guarantee under broken git".
- **Test is gate-agnostic** (fake `pendingParses` stands in for chain-local `pendingParseGate`; dispatcher has no "which file is prose" knowledge) — matches §8's mechanism-agnostic mandate.

No drift, missed cases, undertested logic, scope creep, or gate bypass. CHANGELOG correctly untouched: §9 `### Fixed` "silent plan-prose loss on revert (§8)" is captured by the consolidated `## [0.2.0]` in the `RELEASE-0.2.0` entry — no per-entry cherry-pick.

**`b569104` (chore(flume): ship PLAN-PROSE-DURABILITY).** Removed exactly the PLAN-PROSE-DURABILITY entry (34 deletions, single file, single tag). Clean mechanical ship.

## Promote — WORKTREE-RACE-SERIALIZE → open

Mechanical scan of all `blockedBy`: WORKTREE-RACE-SERIALIZE→PLAN-PROSE-DURABILITY (tag absent from queue — shipped by `b569104`) → **flipped to `{kind:"open"}`**. Remaining links all still resolve: BAIL-CONSTRAINT→WORKTREE, CHAIN-AUTHORING→BAIL-CONSTRAINT, RELEASE→CHAIN-AUTHORING. No other flips. WORKTREE-RACE-SERIALIZE's `files`/`tests`/`acceptance`/`notes` (the prior-tick phantom-canary refinement) untouched — this delta does not touch §4.

## Queue (4 — one open head, then a linear chain)

`WORKTREE-RACE-SERIALIZE` (open, §4 — next for build) → BAIL-CONSTRAINT-LEGIBILITY (§5 audit follow-up) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9). §2/§3 runtime + the full §5/§6 prior-outcome union + §7b afterMerge isolation + §8 prose durability all shipped.

## Open questions

- **3.** Unmoved by this delta — no spec change, no human input arrived, no new evidence. OQ#1 (§7a dogfood chain.ts gate-move, human/`chore(flume):` lane), OQ#2 (unspecced `teardownWorktree`/`WorktreeSetupResult`/`extraEnv` surface — NEEDS AMENDMENT), OQ#3 (`v0.1.1` tag vs CHANGELOG) all byte-unchanged. Not re-litigated.

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` (sole change: WORKTREE-RACE-SERIALIZE gate flip) + `.flume/plan/state.md`. `open-questions.md` and `inbox.md` byte-unchanged (no movement / empty queue). No off-allowlist path filed; audit findings routed entirely into this `plan:` body (conformant build → narrative-only disposition).
- Trunk: HEAD `b569104` (`chore(flume):` ship). No code change this tick (plan-artifact-only). tsc clean, 89 tests pass.

Plan continues: no
