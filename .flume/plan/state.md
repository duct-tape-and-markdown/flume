# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the substantive delta is the `build:` commit `e75e382` (WORKTREE-RACE-SERIALIZE, §4), shipped by `f789788`. No spec delta; inbox empty. Promote also fired (mechanical — WORKTREE-RACE-SERIALIZE shipped → BAIL-CONSTRAINT-LEGIBILITY unblocked).

## Audit — `e75e382` (build: serialize worktree create/teardown against the shared .git/worktrees dir — §4) vs §4

Cross-checked the full diff (`src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) against `spec/RELEASE-v0.2.md` §4 + §9. Trunk green: `pnpm tsc --noEmit` exit 0, 90 tests pass (8 files), the §7b `maxInFlight===2` canary and the new §4 stale-slug test included.

**Conformant.** Three sites, exactly as §4's normative fix mandates:

- **Setup serialized** (Dispatcher.ts:532–535). `Promise.all(batch.map(createWorktree))` → `for (const entry of batch) worktrees.push(await this.createWorktree(...))`. Sequential, placed right after — and mirroring — the already-serialized `pruneWorktrees` (:522). Matches §4's preferred mechanism (`for…await`, no lock primitive).
- **Teardown serialized** (Dispatcher.ts:691–715). Teardown `Promise.all(worktrees.map(...))` → indexed `for` loop; per-worktree order (teardownWorktree hook → `removeWorktree`+`cleaned++` → `deleteBranch`) and the `cleaned/total` log are semantically identical to the parallel original.
- **Agent fanout stays parallel** (Dispatcher.ts:560–561). `runFanoutEntry` `Promise.all` untouched. The `phase.setupWorktree` hook (:543–552) also stays parallel — correct: it does not mutate `.git/worktrees/`; §4 scopes serialization to git-worktree-mutating ops only.

- **Spec-licensed mechanism choice (borderline, recorded so the disposition is defensible).** §4's prose narrows to "the worktree create/remove steps"; the build serialized the *entire* teardown loop, sweeping the `teardownWorktree` hook + `deleteBranch` onto the serial walk rather than interleaving only `removeWorktree` out. §4 mandates the *property* ("serialize every `.git/worktrees/`-mutating git operation; keep agent fanout parallel") and explicitly prefers the simplest mechanism. Serializing all of teardown is a property-satisfying superset at zero fanout cost — teardown is post-ship, off the critical path. Conformant; same spec-licensed-latitude posture as the §8 snapshot audit. Not an OQ (mechanism is build's by spec; no human input); narrative-only here.
- **Files == entry.files exactly.** `src/Dispatcher.ts` + `tests/Dispatcher.test.ts`, both `edit`. No scope creep, no gate bypass.
- **Test ⊇ §4 acceptance.** Seeds a *registered* `git worktree` per slug (stronger than a bare `.git/worktrees/<slug>/` dir — forces the `remove --force`+`add` pair, asserted via a `git worktree list --porcelain` precondition); N=2 wave; asserts both worktrees created + both entries shipped + pending drained (accept. 1), post-teardown `git worktree list` clean on disk and in git (accept. 2). Accept. 3 (fanout still concurrent) is the §7b `maxInFlight===2` canary — green untouched, no phantom standalone re-derived (matches the prior-tick WORKTREE notes + bd5e6f4).
- **CHANGELOG correctly untouched.** §9 `### Fixed` already enumerates "worktree create/teardown race (§4)"; the consolidated `## [0.2.0]` is owned by `RELEASE-0.2.0` (single section, no per-entry cherry-pick) — same pattern as sibling fixes bd5e6f4 (§7b) / 85b0539 (§8).

No drift, missed cases, undertested logic, scope creep, or gate bypass.

**`f789788` (chore(flume): ship WORKTREE-RACE-SERIALIZE).** Removed exactly the WORKTREE-RACE-SERIALIZE entry (34 deletions, single file, single tag). Clean mechanical ship.

## Promote — BAIL-CONSTRAINT-LEGIBILITY → open

Mechanical scan of all `blockedBy`: BAIL-CONSTRAINT-LEGIBILITY→WORKTREE-RACE-SERIALIZE (tag absent from queue — shipped by `f789788`) → **flipped to `{kind:"open"}`**. Remaining links still resolve: CHAIN-AUTHORING→BAIL-CONSTRAINT, RELEASE→CHAIN-AUTHORING. No other flips. BAIL-CONSTRAINT-LEGIBILITY's `files`/`tests`/`acceptance`/`notes` untouched — this delta does not touch §5.

## Queue (3 — one open head, then a linear chain)

`BAIL-CONSTRAINT-LEGIBILITY` (open, §5 audit follow-up — next for build) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9). §2/§3 runtime + the full §5/§6 prior-outcome union + §4 worktree-race serialization + §7b afterMerge isolation + §8 prose durability all shipped.

## Open questions

- **3.** Unmoved by this delta — no spec change, no human input arrived, no new evidence. OQ#1 (§7a dogfood chain.ts gate-move, human/`chore(flume):` lane), OQ#2 (unspecced `teardownWorktree`/`WorktreeSetupResult`/`extraEnv` surface — NEEDS AMENDMENT), OQ#3 (`v0.1.1` tag vs CHANGELOG) all byte-unchanged. Not re-litigated. Note: this tick's audit confirms the serialized teardown loop invokes `teardownWorktree` correctly — does not move OQ#2, which is a spec-authority gap, not an implementation one.

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` (sole change: BAIL-CONSTRAINT-LEGIBILITY gate flip) + `.flume/plan/state.md`. `open-questions.md` and `inbox.md` byte-unchanged (no movement / empty queue). No off-allowlist path filed; audit findings routed entirely into this `plan:` body (conformant build → narrative-only disposition).
- Trunk: HEAD `f789788` (`chore(flume):` ship). No code change this tick (plan-artifact-only). tsc clean, 90 tests pass.

Plan continues: no
