# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the heaviest delta dimension is the `build:` commit `e2959d2` (shipped LOOP-PROCESS-PER-TICK), formalized by harness `5ae566a`. No spec delta (no derive); inbox empty (no drain). One mechanical promote.

## Audit — `e2959d2` (build: process-per-tick supervisor; drop in-process memo/fallback)

Cross-checked against §2 / §3 / §12. **Conformant; one real drift routed.**

- **§2** — `superviseLoop` spawns one `flume tick`/iteration; disk-baton continuation channel (spec-permitted build choice); `--max`/hibernation observable behavior preserved; `diskChainLoader` content-hash memo removed (one load/process); `agent` re-resolves with chain. Acceptance bullets 1/2/3 all have real tests — bullet 1 is a genuine two-real-subprocess integration test (`tests/loop-process-boundary.test.ts`), not a fake loader, exactly as §2 mandates.
- **§3 bullet 2** — `lastChainModule` + retain-last-good removed (correct per §12: moot under process-per-tick); `failed` no-work `TickOutcome` + loud log; `cli.ts tick` exits non-zero on `failed`; supervisor logs+proceeds, never crashes. Tested.
- **§3 bullet 1 / §3 acc. bullet 1** — correctly NOT in this entry: chainLoadGate-revert is `a950a0c`/`Gate.test.ts` (survives unchanged); the §5 prompt-carry is GATE-FAILURE-FEEDBACK's job. No gate-bypass.
- **Scope** — exactly the 4 declared files (`src/Dispatcher.ts`, `src/cli.ts`, `tests/Dispatcher.test.ts`, new `tests/loop-process-boundary.test.ts`). No creep; clean-slate in-place removal (no shims) per §12. The stale old fake-loader §2 test and `loop()`-based fallback tests were correctly deleted and replaced with the right shapes.

**Routed (drift introduced by e2959d2):** the commit deleted the content-hash memo from code but left `docs/CHAIN-AUTHORING.md:14-15` + `:303-304` asserting it exists — published docs now describe a removed mechanism. Build flagged it out-of-scope in the commit body (the doc wasn't in LOOP-PROCESS-PER-TICK's files; correctly not silently patched — pipeline worked as designed). Filed as **CHAIN-AUTHORING-RELOAD-DOCS** (per §2, `open`, docs/-only → build-writable, no OQ).

**Accepted as debt (commit-body only, no entry):**
1. Downstream entries' "shifts after LOOP-PROCESS-PER-TICK / upstream entries" line-hints are now slightly stale but harmless — explicitly fragile/structural pointers, won't build for many ticks; re-pointing every tick as upstream ships is the per-tick re-read bloat-tax the field-discipline rule warns against. Left as-is.
2. No end-to-end real-subprocess `flume loop` test exercising the disk-baton continuation across real children. Spec-conformant: §10 is representative-not-exhaustive and §2 acc. bullet 2 explicitly prescribes the stubbed-spawn loop test (present); bullet 1's real two-subprocess test covers the reload guarantee. The stubbed-spawn unit test transitively proves `Baton.hibernating()` re-reads disk fresh (else it would run to `--max`, not stop at 3).

## Promote — mechanical

- **GATE-FAILURE-FEEDBACK**: was `blockedBy LOOP-PROCESS-PER-TICK`; that tag shipped (`5ae566a`) and left `pending-now`. Re-pointed to `blockedBy CHAIN-AUTHORING-RELOAD-DOCS` — **ordering-only same-file linearization** (both edit `docs/CHAIN-AUTHORING.md`; fanout serializes same-file entries anyway), consistent with this queue's documented linearization discipline. Not promoted to bare `open`: that would create two open heads; the new doc-scrub is the cheaper, independent, drift-fixing head and clears stale §2 prose from the doc *before* §5 layers a new section onto it. The §5→§6/§7b/§8 semantic deps downstream are unchanged.
- No other entry referenced LOOP-PROCESS-PER-TICK as a `blockedBy` gate (other mentions are descriptive line-hint prose, not gates — see Accepted-debt #1).

## Queue (8 entries, linear chain, one open head)

`CHAIN-AUTHORING-RELOAD-DOCS` (open, §2 doc-scrub — NEW, head) → GATE-FAILURE-FEEDBACK (§5, keystone; unblocks §6/§7b/§8) → NO-COMMIT-TAXONOMY (§6) → AFTERMERGE-REVERT-ISOLATION (§7b, heaviest) → PLAN-PROSE-DURABILITY (§8) → WORKTREE-RACE-SERIALIZE (§4) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9).

## Open questions

- **3**, all unchanged this tick (no movement; no human input arrived):
  1. §7a dogfood `.flume/chain.ts` gate-placement move — off build's writablePaths + builtin `when` affordance gap; gated on §7b (PARKED; rec A: post-§7b `chore(flume):` move).
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — v0.2 rewrite still didn't fold it in (PARKED — NEEDS AMENDMENT; rec A).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A).
- OQ#1 (§2 in-process reload mechanism) remains CLOSED — resolved by `4187f44`, derived as LOOP-PROCESS-PER-TICK, now shipped + audited conformant this tick.

## Writable-paths / trunk

- New entry CHAIN-AUTHORING-RELOAD-DOCS touches only `docs/CHAIN-AUTHORING.md` — within build's `docs/**` writablePaths. No off-allowlist piece, no new OQ. All other entries' targets unchanged and previously verified.
- Trunk: HEAD `5ae566a`. e2959d2 is a `build:` commit → landed only after green tscGate+vitestGate per CLAUDE.md non-negotiables; plan does not re-run gates (investigate-don't-execute). No code change this tick (plan-artifact-only).

Plan continues: no
