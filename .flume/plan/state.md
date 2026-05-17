# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the substantive delta is the `build:` commit `5f5a86c` (BAIL-CONSTRAINT-LEGIBILITY, §5), shipped by `c9dd21f`. No spec delta; inbox empty. Promote also fired (mechanical — BAIL-CONSTRAINT-LEGIBILITY shipped → CHAIN-AUTHORING-GATE-GUIDANCE unblocked).

## Audit — `5f5a86c` (build: extract the agent's final message before bounding a voluntary-bail — §5) vs §5/§6

Cross-checked the full diff (`src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) against `spec/RELEASE-v0.2.md` §5 + §6 + §9. Trunk green: `pnpm tsc --noEmit` exit 0, 91 tests pass (8 files) — the new stream-json voluntary-bail case and the §2 process-boundary integration test included.

**Conformant.**

- **Load-bearing premise verified, not assumed.** The fix is predicated on "the dogfood decorators pass stdout raw, so `AgentResult.stdout` is the NDJSON transcript." Confirmed at source: `withSessionCapture` (`Agent.ts:202-227`) tees the `onStdout` *callback* to a file and returns `agent.invoke(wrapped)` unchanged; `withTerminalRenderer` (`:270-307`) renders only the streaming callback, returns `AgentResult` unchanged; base `claudeCode` (`:140-158`) accumulates raw `proc.stdout` into `AgentResult.stdout`. Dogfood chain (`.flume/chain.ts:284-287`) is `outputFormat:"stream-json"`. So `buildVoluntaryBail`'s `stdout` is raw NDJSON — the pre-fix `tailBound(stdout)` forwarded escaped-JSON result/assistant + cost/usage, exactly the §6 noise §5 exists to kill. Premise sound; fix correctly targeted.
- **§5/§6 conformance.** Legibility fix on the *content* of the already-shipped voluntary-bail variant — `finalAgentMessage` lifts the terminal `result` text, else last `assistant` turn text, else the raw plain-text tail. §5's bound (`tailBound`/`MAX_PRIOR_NOCOMMIT`) and the empty-message placeholder are preserved per entry directive. Does not re-derive gate-revert, does not redesign the union (§6 owns detect/classify; §5 owns channel shape — this touches neither contract).
- **In-lane architectural call.** Extraction in Dispatcher, no `AgentResult.finalMessage` surface add — matches the shipped entry's explicit "prefer in-lane extraction" note and avoids minting a fresh unspecced-v0.1-§2-surface OQ (the OQ#2 pattern). Correct.
- **No plain-text regression by construction.** The `!sawStreamJson` branch is byte-identical to the old `tailBound(stdout.trim(), MAX_PRIOR_NOCOMMIT)`; the pre-existing plain-text voluntary-bail test stays green (91 pass).
- **Files == entry.files exactly.** `src/Dispatcher.ts` + `tests/Dispatcher.test.ts`, both `edit`. No scope creep, no gate bypass.
- **Test ⊇ acceptance.** Realistic `JSON.stringify`'d transcript (system/init, interim assistant, tool_use/tool_result, final assistant, result+cost/usage). Asserts: legible constraint present in the voluntary-bail variant; NDJSON/cost noise absent (`"type":"result"`, `tool_use`, `total_cost_usd`, `cache_read_input_tokens`, `duration_ms`, `\"text\"`); first-attempt slot empty (§5 acc. 2); variant exclusivity (no `GATE_REVERT_INTRO`/`PREEMPT_INTRO`). Stronger than acceptance.
- **CHANGELOG correctly untouched.** §9 `### Added` already enumerates the prior-outcome channel (§5/§6); the consolidated `## [0.2.0]` is owned by `RELEASE-0.2.0` — same single-section pattern as sibling fixes.

**Accepted as debt (narrative-only — negligible, no entry/OQ).** A *plain-text* agent whose bail prose contained a standalone line that JSON-parses to an object with a string `type` key would set `sawStreamJson` and fall through to the safe `(agent exited cleanly…)` placeholder. Off the dogfood path (it is stream-json), safe-degrading, and prompts instruct the constraint as prose — not worth a pending entry or OQ. Recorded so the disposition is defensible (same posture as the §4 mechanism-latitude note).

No drift, missed cases, undertested logic, scope creep, or gate bypass.

**`c9dd21f` (chore(flume): ship BAIL-CONSTRAINT-LEGIBILITY).** Removed exactly the BAIL-CONSTRAINT-LEGIBILITY entry (34 deletions, single file, single tag). Clean mechanical ship.

## Promote — CHAIN-AUTHORING-GATE-GUIDANCE → open

Mechanical scan of all `blockedBy`: CHAIN-AUTHORING-GATE-GUIDANCE→BAIL-CONSTRAINT-LEGIBILITY (tag absent from queue — shipped by `c9dd21f`) → **flipped to `{kind:"open"}`**. RELEASE-0.2.0→CHAIN-AUTHORING-GATE-GUIDANCE still resolves (tag present). No other flips. Rest of the CHAIN-AUTHORING-GATE-GUIDANCE entry (`files`/`tests`/`acceptance`/`notes`) untouched — promote is mechanical; the now-historical "blockedBy linearizes Dispatcher.ts-touch order" sentence in `notes` is harmless context, not re-litigated. The semantic want it cited (§7b landed first) is satisfied — `AFTERMERGE-REVERT-ISOLATION` shipped (`bd5e6f4`/`b58974d`), so the afterMerge guidance is no longer pre-isolation footgun-shaped.

## Queue (2 — one open head, then one blocked)

`CHAIN-AUTHORING-GATE-GUIDANCE` (open, §7a/§7c docs — next for build) → `RELEASE-0.2.0` (blockedBy CHAIN-AUTHORING-GATE-GUIDANCE, §9). §2/§3 runtime + the full §5/§6 prior-outcome union (incl. this tick's voluntary-bail legibility fix) + §4 worktree-race serialization + §7b afterMerge isolation + §8 prose durability all shipped. Only the §7 docs entry + the release cut remain.

## Open questions

- **3.** Unmoved by this delta — no spec change, no human input arrived, no new evidence. OQ#1 (§7a dogfood chain.ts gate-move, human/`chore(flume):` lane), OQ#2 (unspecced `teardownWorktree`/`WorktreeSetupResult`/`extraEnv` surface — NEEDS AMENDMENT), OQ#3 (`v0.1.1` tag vs CHANGELOG) all byte-unchanged. Not re-litigated. This tick's audit confirms the §5 voluntary-bail channel now carries a legible constraint — it does not touch any OQ (none concern §5 content shape).

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` (sole change: CHAIN-AUTHORING-GATE-GUIDANCE gate flip) + `.flume/plan/state.md`. `open-questions.md` and `inbox.md` byte-unchanged (no movement / empty queue). No off-allowlist path filed; audit findings routed entirely into this `plan:` body (conformant build → narrative-only disposition; one negligible robustness nit accepted as debt).
- Trunk: HEAD `c9dd21f` (`chore(flume):` ship). No code change this tick (plan-artifact-only). tsc clean, 91 tests pass.

Plan continues: no
