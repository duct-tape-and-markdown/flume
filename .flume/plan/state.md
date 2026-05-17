# State

Phase: **v0.1 line shipped; v0.2 derive line active.** Mode this tick: **audit** — heaviest dimension is the PER-TICK-CHAIN-RELOAD build (`0c24b29`) + its harness ship (`d05e297`), which carried an architectural flag in its commit body. No spec delta (no derive); inbox empty (no drain). Promote fired (mechanical).

## Audit — `0c24b29` (build PER-TICK-CHAIN-RELOAD) + `d05e297` (ship)

- **Conformance: green.** §2 mechanism implemented as prescribed — per-tick `chainLoader()` at `tick()` top (`Dispatcher.ts:233`), `diskChainLoader` content-hash memoized (`:82`), `DispatcherOptions.chain` removed in place + `chainLoader?` added, `agent` re-resolves with the chain. All three §2 acceptance tests present and passing. Files touched = entry.files exactly (cli/Dispatcher/index/Dispatcher.test/CHAIN-AUTHORING) — **no scope creep**.
- **`.flume/chain.ts` verified uncoupled** — `grep` confirms zero `Dispatcher`/`chainLoader`/`chain:` refs; the §2 break stayed inside build-writable `src/+tests/+docs/`, exactly as the prior plan predicted. §5 "same commit" concern vacuous (confirmed, not just asserted).
- **`d05e297`** faithful harness-lane ship (pending.json only; removed PER-TICK-CHAIN-RELOAD, normalized remaining gate formatting). Off plan's writable paths; not separately actionable.
- **One material finding → new OQ.** §2's prescribed mechanism (`tsImport`+content-hash) cannot deliver §2's own in-process headline guarantee; §2's acceptance test uses a fake loader so the suite is green while the disk-reload intent is untested. Build flagged honestly via commit body (correct: open-questions.md off its writable paths) — did not paper over. Routed to open-questions with *Inform-before-parking* research folded in (tsx docs contradict the build's empirical claim → disposition branches on a reproduction probe). NOT a pending entry: no clean buildable unit (4 options, several human-lane spec edits, one zero-code), and the premise needs a probe first.

## Promote (mechanical)

- **CHAIN-LOAD-GATE: `blockedBy PER-TICK-CHAIN-RELOAD` → `open`.** Dep no longer in pending (shipped `d05e297`). It is now queue head, pickable. Unaffected by the new OQ (chainLoadGate + engine fallback is orthogonal to in-process disk reload).
- Audit-driven pointer maintenance (plan re-derives pending vs current src): CHAIN-LOAD-GATE description `loadChain`→`diskChainLoader` (loadChain no longer exists post-ship); WORKTREE-RACE-SERIALIZE line cites re-anchored `:257/:284/:353`→`:366/:393/:468` (diskChainLoader added ~140 lines; spec §4's cites are pre-reload); RELEASE-0.2.0 notes flag the CHANGELOG `### Added` wording contingent on the new OQ.

## Queue / OQs / trunk

- Queue head: **CHAIN-LOAD-GATE** (open, pickable). WORKTREE-RACE-SERIALIZE `blockedBy` it; RELEASE-0.2.0 `blockedBy` that. In flight: nothing.
- Open questions: **3** —
  1. **NEW** — §2's `tsImport`+content-hash mechanism can't deliver §2's in-process reload guarantee (PARKED/NEEDS AMENDMENT; rec: run reproduction probe (0) first — tsx docs contradict the build's empirical finding; then likely (d) amend §2 prose, else (a) bump tsx).
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — v0.2 spec shipped without folding it in (PARKED/NEEDS AMENDMENT; rec A).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A: keep tags, correct CHANGELOG).
- Writable-paths: all 3 remaining entries' targets (`src/**`, `tests/**`, `package.json`, `CHANGELOG.md`) within build's writablePaths. No off-allowlist target; no chain.ts amendment needed.
- Trunk: `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, **71** tests, was 68 — PER-TICK-CHAIN-RELOAD added 3 §2 tests). HEAD `d05e297`. (ci.yml runs on push/PR — not plan-verifiable locally.)

Plan continues: no
