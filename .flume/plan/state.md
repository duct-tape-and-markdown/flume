# State

Phase: **v0.3 line ACTIVE** — `spec/RELEASE-v0.3.md` (foundations governor §§1-9, relocatable state §§10-15, +§16 flumeDir exposure). Mode this tick: **derive** — decomposed the new §16 into one buildable entry. v0.1 + v0.2 frozen.

## This tick — derived §16 → FLUMEDIR-CONTEXT-EXPOSURE

Delta: 2 commits since `82b7c93` (last `plan:`), both human-lane:
- **`5ac3b28` spec: add §16** to RELEASE-v0.3.md — the derive trigger.
- **`a597fc8` docs: INTENT.md** commit-as-transaction invariant — docs lane, consistent, no spec/code surface to derive.

**Audit:** no targets. Both delta commits are human-authored `spec:`/`docs:`, not `build:` commits citing a `per` — nothing to cross-check against an entry. §16 itself is internally consistent with the runtime (verified the four named seams below all exist and are un-threaded today).

**Derive (§16):** one entry, `FLUMEDIR-CONTEXT-EXPOSURE`. §16 is one ergonomic primitive exposing the dispatcher's resolved `this.flumeDir` through three thin seams, all file-coupled on `src/Dispatcher.ts` (no fanout benefit to splitting):
- `GateContext.flumeDir` (`src/Gate.ts`) — threaded into both `gate.run` ctxs (Dispatcher ~l660 afterMerge, ~l957 afterCommit).
- `TickContext.flumeDir` (`src/Phase.ts`) — set at both TickContext sites (Dispatcher ~l451 singleton, ~l836 fanout); surfaced to `promptArgs(ctx)`.
- Reserved `{{FLUME_DIR}}` — auto-injected into both `renderPrompt` arg maps (Dispatcher ~l452, ~l837); `src/Prompt.ts` doc-comment notes it.
Verified all four sites read `this.flumeDir` (resolved at Dispatcher ctor l349) and that no FLUME_DIR prompt-arg injection exists yet. Tests: `tests/Gate.test.ts`, `tests/Dispatcher.test.ts`, new `tests/Prompt.test.ts` (no renderPrompt test exists today). Additive 0.3.0, no signature breaks. `writablePaths` stays env-derived (§16b) — flagged in entry notes as a deliberate non-change.

**Routed off-allowlist surface → OQ#5:** §16's named dogfood `pendingParseGate` adoption of `ctx.flumeDir` (`.flume/chain.ts`) is outside build's writablePaths → parked (chore lane), blocked on the build entry shipping. Captured the `cwd`-vs-`flumeDir` semantic nuance so the chore lands deliberately.

## Queue (1)

- **FLUMEDIR-CONTEXT-EXPOSURE** (`open`) — §16 flumeDir exposure; ready to ship.

## Active plan target

`spec/RELEASE-v0.3.md` — §§1-15 shipped+audited clean; §16 now derived (1 open entry). After this entry ships, the v0.3 derivable surface is complete again; next plan work needs a new spec section or an OQ resolution.

## Open questions

**5 (all PARKED).** New this tick: **OQ#5** (§16 dogfood chain.ts gate adoption — off-allowlist, chore lane, blocked on FLUMEDIR-CONTEXT-EXPOSURE). Carried: OQ#1 (§7a chain.ts gate-move), OQ#2 (v0.1.2 worktree surface unspecced), OQ#3 (v0.1.1 tag vs CHANGELOG), OQ#4 (orphaned-baton Axis-C). None of the carried four implicated by this delta; not re-litigated.

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}` only. inbox empty, untouched. No off-allowlist path.
- Trunk: HEAD `a597fc8`. Plan-artifact-only tick. tsc not re-run (no src/ delta this tick).

Plan continues: no
