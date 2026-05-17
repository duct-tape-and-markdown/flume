# State

Phase: **v0.1 line shipped (`@dtmd/flume@0.1.2`, tags `v0.1.0/.1/.2`); v0.2 spec committed (`2e2fc5b`) → v0.2 derive active.** Mode this tick: **derive** — heaviest dimension is the new normative spec file `spec/RELEASE-v0.2.md`. Inbox empty; pending was `[]` (no drain, no promote).

## Derive — `spec/RELEASE-v0.2.md` (`2e2fc5b`)

Decomposed §2/§3/§4/§5 into **4 entries**, linear `blockedBy` chain (all three functional entries touch `src/Dispatcher.ts` → fanout partitioner serializes them regardless; the chain also lets the single-tag `blockedBy` express "release gates on all prior"):

1. **PER-TICK-CHAIN-RELOAD** (§2, open) — per-tick content-hash-memoized chain resolution; remove `DispatcherOptions.chain`, add `chainLoader?`. Confirmed by source read: the §2 break is confined to build-writable `src/cli.ts` + `src/Dispatcher.ts` + `src/index.ts` + `tests/Dispatcher.test.ts` + `docs/CHAIN-AUTHORING.md:298`. **`.flume/chain.ts` needs no edit** (it never constructs Dispatcher; `Chain`/`Phase` types unchanged) → the latent §5 "chain.ts in same commit" / writablePaths concern is vacuous here. Recorded in the entry's notes.
2. **CHAIN-LOAD-GATE** (§3, blockedBy 1) — builtin `chainLoadGate` + engine last-good fallback. Dogfood chain does not declare it (no flume-on-flume phase writes `.flume/chain.ts`); engine fallback is its net.
3. **WORKTREE-RACE-SERIALIZE** (§4, blockedBy 2) — `Dispatcher.ts:257`/`:353` Promise.all → `for…await`; agent fanout `:284` stays parallel. Spec line cites verified against current `Dispatcher.ts` (254/257/284/353/517/527 all match).
4. **RELEASE-0.2.0** (§5, blockedBy 3) — `package.json` → 0.2.0 + consolidated `## [0.2.0]` CHANGELOG (one section, avoids 3-way cherry-pick conflict). npm publish + git tag = human ceremony, out of build scope.

§1/§7/§8 are scope/non-goals/audit-reference (not derivable units); §6 tests folded into each entry's `tests[]` per the v0.1 §5 representative-not-exhaustive posture.

## Audit (commit-delta)

- **`173ad39` (`chore(flume):` de-version spec directives).** Faithful, harness lane (off plan's writable paths). Generalizes 8 sites to `spec/RELEASE-*.md` and relaxes "human-curated" → "human-directed, edited in-session". Directly enables this tick: plan.md's `per.path` directive is now corpus-relative — entries cite `spec/RELEASE-v0.2.md` accordingly. No spec authority needed (chore).
- **`2e2fc5b` (`spec:`)** is the derive source itself (human lane), not separately audited.

## Resolved this tick

- **OQ #1 (v0.2 untracked) — CLOSED.** Human committed `spec/RELEASE-v0.2.md` as `2e2fc5b` (took recommendation A) and the harness-lane working-tree edits as `173ad39`. Block lifted; queue derived. Removed from open-questions.

## Queue / OQs / trunk

- Queue head: **PER-TICK-CHAIN-RELOAD** (open, pickable). Entries 2–4 `blockedBy` chained behind it. In flight: nothing.
- Open questions: **2** —
  1. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — v0.2 spec committed *without* folding it in despite the standing rec; the obvious window closed (PARKED/NEEDS AMENDMENT; rec A: amend v0.2 spec, which now also implies a §1 scope call).
  2. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A: keep tags, correct CHANGELOG — build follow-up once decided).
- Writable-paths: all 4 entries' file targets (`src/**`, `tests/**`, `docs/**`, `package.json`, `CHANGELOG.md`) are within build's writablePaths. No off-allowlist target; no chain.ts amendment needed.
- Trunk: `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests) — verified this tick. HEAD `2e2fc5b`. (ci.yml runs on push/PR — not plan-verifiable locally.)

Plan continues: no
