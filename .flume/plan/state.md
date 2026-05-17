# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the heaviest (and only substantive) delta dimension is the `build:` commit `58d8491` (NO-COMMIT-TAXONOMY); `7d493d1` is its harness ship (entry removed from pending.json). No spec delta; inbox empty. Promote also fired (mechanical — NO-COMMIT-TAXONOMY shipped, AFTERMERGE unblocked).

## Audit — `58d8491` (build: classify the three no-commit modes; widen §5 union in place) vs §5/§6

Cross-checked the full diff (`src/Prompt.ts`, `src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) against `spec/RELEASE-v0.2.md` §5 + §6 (+ §12 widen-in-place mandate).

**Conformant core.** `PriorAttempt` → mode-tagged union (`GateRevertAttempt | VoluntaryBailAttempt | PlatformPreemptAttempt`); `priorAttemptLines` renders each variant distinctly with gate-revert text byte-preserved; `readPriorAttempt` now validates the `mode` discriminant (unknown → absent, no false signal); detection wired at singleton + fanout-per-entry + both gate-revert paths; `TickOutcome.noCommit` + `summarize` carry the logger record. Files == `entry.files` exactly (no scope creep); `schemaDelta: none` correct (records live in `.flume/prior-attempts/*.json`, not PendingSchema); no gate-bypass. §5 afterMerge gate-revert rendering **not regressed** — the pre-existing §5 test (`tests/Dispatcher.test.ts:719`, `Reverted at: afterMerge`) survived the union reshape (vitest gate green; shipped by `7d493d1`).

**Finding 1 (filed → `BAIL-CONSTRAINT-LEGIBILITY`).** `buildVoluntaryBail` does `tailBound(result.stdout.trim())` and the commit asserts "the agent's final message lives at the tail of stdout." True only for `claudeCode({outputFormat:"text"})`. The dogfood `.flume/chain.ts` — the autonomous loop §6 actually targets — runs `withTerminalRenderer(withSessionCapture(claudeCode({stream-json})))`; both decorators pass `result.stdout` through **raw**, so the tail is escaped-JSON `assistant`/`result` events + cost/usage, not the legible refused-constraint sentence. Tests pass only because the fake agents emit plain-text stdout — the real path is undertested + degraded against §6's "legible without reading session logs" bar. Routed to a pending entry (`per` §5), not an OQ: spec mandates the *property* (legible constraint), mechanism is build's (§8-style), and an in-lane Dispatcher-side extraction avoids the OQ#2 unspecced-public-surface trap. Slotted `blockedBy WORKTREE-RACE-SERIALIZE` (last Dispatcher.ts-touching functional entry) to preserve the queue's Dispatcher.ts-touch linearization; CHAIN-AUTHORING-GATE-GUIDANCE re-pointed `blockedBy` WORKTREE → BAIL-CONSTRAINT so the chain stays linear.

**Finding 2 (accepted debt + cross-tick pointer).** The commit body flags a spec-silent judgment call: the *wave-level* `TickOutcome.noCommit` precedence `gate-revert > platform-preempt > voluntary-bail`. §6 mandates only the **per-entry** durable channel — correctly implemented (each entry's true mode persisted regardless). The wave-level label is a logger convenience the spec does not pin; the chosen precedence is well-reasoned and tied to §6's stated harm (platform failures masquerading as agent failures). Not parking a non-question (collaboration *Inform before parking*) → accepted as debt. BUT `runFanout`'s `if (!waveOk && shipped.length>0) modes.add("gate-revert")` branch is coupled to the *current whole-wave* afterMerge revert, which §7b (AFTERMERGE-REVERT-ISOLATION, now the head) changes — added a telegraphic re-derive pointer to that entry's `notes`.

## Promote — AFTERMERGE-REVERT-ISOLATION → open

Mechanical scan of all `blockedBy`: AFTERMERGE→NO-COMMIT-TAXONOMY (tag absent from queue — shipped by `7d493d1`) → **flipped to `{kind:"open"}`**. Remaining links all still resolve: PLAN-PROSE→AFTERMERGE, WORKTREE→PLAN-PROSE, BAIL-CONSTRAINT→WORKTREE (new), CHAIN-AUTHORING→BAIL-CONSTRAINT (re-pointed), RELEASE→CHAIN-AUTHORING. No other flips.

## Queue (6 — one open head, then a linear chain)

`AFTERMERGE-REVERT-ISOLATION` (open, §7b — heaviest; next for build) → PLAN-PROSE-DURABILITY (§8) → WORKTREE-RACE-SERIALIZE (§4) → BAIL-CONSTRAINT-LEGIBILITY (§5 audit follow-up) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9). §2/§3 runtime + the full §5/§6 prior-outcome union shipped (PER-TICK-CHAIN-RELOAD, LOOP-PROCESS-PER-TICK, CHAIN-AUTHORING-RELOAD-DOCS, CHAIN-LOAD-GATE, GATE-FAILURE-FEEDBACK, CHAINLOAD-FEEDBACK-TEST, NO-COMMIT-TAXONOMY).

## Open questions

- **3**, all unchanged this tick. The §5/§6 audit touches none of their surfaces and no human input arrived — not re-litigated (collaboration rule):
  1. §7a dogfood `.flume/chain.ts` gate-placement move — off build's writablePaths + builtin `when` affordance gap; gated on §7b (PARKED; rec A).
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — still un-folded (PARKED — NEEDS AMENDMENT; rec A). Referenced as the precedent anchor in BAIL-CONSTRAINT's notes (why prefer in-lane extraction over an `AgentResult.finalMessage` public-surface add).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A).

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` + `.flume/plan/state.md` (plan writable paths). open-questions.md + inbox.md byte-unchanged (no human input, empty queue). BAIL-CONSTRAINT-LEGIBILITY files (`src/Dispatcher.ts`, `tests/Dispatcher.test.ts`) are in build's code lane — no off-allowlist path filed.
- Trunk: HEAD `7d493d1` (`chore(flume):` ship). No code change this tick (plan-artifact-only).

Plan continues: no
