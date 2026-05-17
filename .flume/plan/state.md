# State

Phase: **v0.1 line shipped; v0.2 derive line active.** Mode this tick: **derive** — the heaviest delta dimension is the v0.2 spec rewrite (`4187f44`): §2 re-architected (in-process content-hash → process-per-tick supervisor), new normative §5–§8. Audit (`a950a0c`) is folded into the re-derivation. Inbox empty (no drain).

## Derive — `4187f44` (spec: integrate v0.2)

The whole v0.2 queue was re-derived; pending.json went 2 → 8 entries:

- **LOOP-PROCESS-PER-TICK** (§2, open, queue head) — `flume loop` → supervisor spawning `flume tick`/iteration; drop diskChainLoader content-hash memo + lastChainModule. Supersedes the mechanism PER-TICK-CHAIN-RELOAD shipped (0c24b29).
- **GATE-FAILURE-FEEDBACK** (§5) — bounded prior-attempt block persisted to disk, injected into the rendered prompt like the `<harness>` block. Highest-leverage; §6/§7b/§8 build on it. Also closes §3 acceptance bullet 1.
- **NO-COMMIT-TAXONOMY** (§6) — gate-revert | voluntary-bail | platform-preempt on TickOutcome + §5 block.
- **AFTERMERGE-REVERT-ISOLATION** (§7b) — per-entry afterMerge revert, not whole-wave `hardResetTo(preHead)`. Heaviest item per §12.
- **PLAN-PROSE-DURABILITY** (§8) — gate-reverted plan tick must not silently lose state.md/open-questions.md prose.
- **WORKTREE-RACE-SERIALIZE** (§4) — carried over, cites re-anchored (line numbers shift again after the upstream Dispatcher.ts entries; cited structurally).
- **CHAIN-AUTHORING-GATE-GUIDANCE** (§7a-doc + §7c) — docs/, build-writable.
- **RELEASE-0.2.0** (§9) — version + the now-four-subsection CHANGELOG; CONTINGENT note rescoped (OQ#1 resolved, §7a-chain OQ open).

Linear `blockedBy` chain (one open head). Honest: §5→§6/§7b/§8 are semantic deps; §2→§5 is semantic; the rest linearizes the all-touch-`src/Dispatcher.ts` order (fanout serializes same-file entries anyway).

## Audit — `a950a0c` (build: chainLoadGate + engine fallback)

- **Conformed to the §3 that existed at ship time (11:05Z), then superseded by the 11:19Z spec rewrite.** Not a build error: build flagged the tsx in-process-reload bound in its `loadChainModule` JSDoc + commit body; the human resolved it by re-architecting §2 to process-per-tick (`4187f44`, §12 resolved-decision). Pipeline worked as designed for an architectural misstep.
- **Disposition (accepted, folded — not a standalone entry):** the `lastChainModule` retain-last-good-in-process fallback + `diskChainLoader` content-hash memo are now moot under process-per-tick → **retired by LOOP-PROCESS-PER-TICK** (per §2/§3/§12). The rest of `a950a0c` survives unchanged and correct under new §3: `chainLoadGate` (builtin, afterCommit), `loadChainModule`, the `src/index.ts` export, the Gate.test.ts coverage. Per §12 ("Plan must not derive §3 as independently shippable") no standalone §3 entry — §3 acceptance bullet 2 folds into LOOP-PROCESS-PER-TICK, bullet 1 into GATE-FAILURE-FEEDBACK.
- `f3fc21c` / `2675c1c` are `chore(flume):` harness-lane (plan.md cap-contradiction fix; mechanical CHAIN-LOAD-GATE ship). No plan action; the f3fc21c fix is why this large derive can stay within the 200/500 caps.

## Open questions

- **3** —
  1. **NEW** — §7a dogfood `.flume/chain.ts` gate-placement move is off build's writablePaths + a builtin `when` affordance gap; gated on §7b (PARKED; rec A: post-§7b `chore(flume):` move). Scopes the only genuinely off-allowlist piece of the v0.2 derivation.
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — updated: the v0.2 rewrite expanded the spec but *still* didn't fold it in; stale "only these three" framing corrected (PARKED/NEEDS AMENDMENT; rec A).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A).
- **CLOSED this tick:** OQ#1 (§2 in-process reload mechanism) — resolved by the human spec rewrite `4187f44` (process-per-tick; §12 resolved-decision records the empirical Node-ESM constraint). Derived as LOOP-PROCESS-PER-TICK.

## Promote

- WORKTREE-RACE-SERIALIZE's prior `blockedBy CHAIN-LOAD-GATE` is stale (CHAIN-LOAD-GATE shipped `2675c1c`); subsumed by the full re-derivation — it now `blockedBy PLAN-PROSE-DURABILITY` in the new linear chain (ordering-only).

## Writable-paths / trunk

- All 8 entries' commit targets verified within build's writablePaths (`src/**`, `tests/**`, `docs/**`, `package.json`, `CHANGELOG.md`, `.gitignore`). The prior-attempt store (GATE-FAILURE-FEEDBACK) is gitignored runtime state, not a committed path. Only off-allowlist piece — the §7a dogfood chain.ts gate-move — is parked as OQ#1(new), not filed.
- Trunk: HEAD `f3fc21c`. `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 71 tests) at last audit; no code change this tick. (ci.yml runs on push/PR — not plan-verifiable locally.)

Plan continues: no
