# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — heaviest delta dimension is the `build:` commit `22487fd` (GATE-FAILURE-FEEDBACK / §5), shipped by harness `3404fe4`. No spec delta (no derive); inbox empty (no drain). One audit finding routed; one mechanical promote.

## Audit — `22487fd` (build: forward gate-revert context to the retrying tick)

Cross-checked the diff against `spec/RELEASE-v0.2.md` §5 (the entry's `per` cite) and the GATE-FAILURE-FEEDBACK entry's declared scope. **Conformant; one composite-acceptance test gap routed (not drift).**

- **Scope** — exactly the 5 declared files (`src/Dispatcher.ts`, `src/Prompt.ts`, `docs/CHAIN-AUTHORING.md`, `.gitignore`, `tests/Dispatcher.test.ts`); the `pending.json` −46 belongs to the separate `chore(flume)` ship `3404fe4`. No creep.
- **§5 acceptance** — all three bullets carry asserting tests: afterCommit (boom-gate, full details + marker + first-attempt-absent), afterMerge (per-reverted-entry, symmetric), clear-on-clean-ship. Cross-process by construction: record persisted under `.flume/prior-attempts/` at repo root (not the per-entry worktree — survives a fanout retry's fresh worktree), read at render. Bounded (8K details / 4K diffstat, visible-elision `bound()`).
- **§5 "documented slot"** — satisfied via the dispatcher-owned `<prior-attempt>` block mirroring `<harness>` (no `{{token}}`, no `promptArgs`), documented in `docs/CHAIN-AUTHORING.md`. This is the plan-vetted interpretation (GATE-FAILURE-FEEDBACK notes + OQ#1 lane: `.flume/prompts/*.md` is off build's writablePaths; the `<harness>` precedent resolves "documented slot"). Re-affirmed conformant, not re-litigated.
- **In-place API change** — `runAfterCommitGates` return `firstFailure?: string` → `failure?: {gate,message,details?}`; all callers updated, `git grep firstFailure` = 0 hits (pre-1.0 clean-slate posture, no shim). `slugify` extracted as a shared helper (worktree + prior-attempt keying) — in declared file, DRY, not creep.
- **afterMerge under whole-wave revert** — every reverted wave entry (incl. clean siblings) gets the merge-time record. Correct under today's whole-wave revert; per-entry isolation is §7b (AFTERMERGE-REVERT-ISOLATION, separate pending entry) — consistent with the spec and commit body.
- **No gate-bypass** — `build:` commit then a pure 46-line `chore(flume)` ship-removal of the entry from pending.json. Build ran gates per CLAUDE.md non-negotiables (plan investigates, does not re-run gates).

**Routed (one pending entry, not OQ, not silent debt):** `CHAINLOAD-FEEDBACK-TEST` — §3 acceptance bullet 1 attaches "(test)" to the composite *broken chain.ts → chainLoadGate revert → restored → next tick's prompt carries the chain-load failure per §5*. Both runtime halves are shipped (`CHAIN-LOAD-GATE` `2675c1c`; this commit), but the existing §3 test (`tests/Dispatcher.test.ts:906`) predates §5 and stops at "chain-load is the recorded failure" — no follow-up tick, no `<prior-attempt>` assertion. §5's boom-gate test exercises the same gate-uniform path, but the spec names this composite as a test and §3↔§5 ship-together is the release keystone (§12). Test-only, build-writable, unblocked → `open`, queue head. Not an OQ (no human input), not silent debt (spec-named acceptance for the keystone).

## Promote — mechanical

- **NO-COMMIT-TAXONOMY**: was `blockedBy GATE-FAILURE-FEEDBACK`; that tag shipped (`3404fe4`) and left `pending-now`. Flipped to `gate: { kind: "open" }`. `files`/`notes` untouched — minimal churn; the "Depends on GATE-FAILURE-FEEDBACK for the §5 block channel" note is now a satisfied-dependency statement, still accurate.
- No other entry's `blockedBy` references a now-absent tag — the rest is a linear chain (each blocks on the one directly above), all still pending. No further promotes.

## Queue (7 entries — two open heads, then linear chain)

`CHAINLOAD-FEEDBACK-TEST` (open, NEW head — closes the §3↔§5 keystone composite acceptance; test-only) → `NO-COMMIT-TAXONOMY` (open, promoted, §6) → AFTERMERGE-REVERT-ISOLATION (§7b, heaviest) → PLAN-PROSE-DURABILITY (§8) → WORKTREE-RACE-SERIALIZE (§4) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9). §2/§3 runtime already shipped (PER-TICK-CHAIN-RELOAD, LOOP-PROCESS-PER-TICK, CHAIN-AUTHORING-RELOAD-DOCS, CHAIN-LOAD-GATE).

## Open questions

- **3**, all unchanged this tick (no spec delta, no commit touched these surfaces, no human input — not re-litigated per collaboration rule):
  1. §7a dogfood `.flume/chain.ts` gate-placement move — off build's writablePaths + builtin `when` affordance gap; gated on §7b (PARKED; rec A: post-§7b `chore(flume):` move).
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — v0.2 rewrite still didn't fold it in (PARKED — NEEDS AMENDMENT; rec A).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A).

## Writable-paths / trunk

- Only the new `CHAINLOAD-FEEDBACK-TEST` entry was added + NO-COMMIT-TAXONOMY's gate flipped, both in `.flume/plan/pending.json` (a plan writable path). The new entry's sole target `tests/Dispatcher.test.ts` is within build's `tests/**` writablePaths (no off-allowlist piece → pending entry, not OQ).
- Trunk: HEAD `3404fe4`. `22487fd` is a `build:` commit → landed only after green tscGate+vitestGate per CLAUDE.md non-negotiables. No code change this tick (plan-artifact-only).

Plan continues: no
