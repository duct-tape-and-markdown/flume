# Flume — v0.2.0 Release Target

The human-directed ship target for the 0.2.0 minor — owned by the human, edited in interactive sessions under explicit direction, never by an autonomous phase. Plan derives pending entries against this; build executes them. When something here is ambiguous, the answer goes through `.flume/plan/open-questions.md` → human edit of this file → next plan tick.

This is a release-readiness doc, not a design doc. Design intent lives in `docs/INTENT.md`. `spec/RELEASE-v0.1.md` stays frozen as the v0.1-line target; its §2 (public surface) and §9 (versioning policy) remain governing — this doc *adds to* that surface (`chainLoadGate`), *breaks* it (`DispatcherOptions`), and *fixes behavior behind* it (worktree serialization, internal). The §2 break is why this is a minor per v0.1 §9, not a patch.

Status: **READY FOR PLAN.** All design questions resolved. Sections below are normative for plan derivation.

## 1. Purpose & scope

0.2.0 is **dispatcher correctness for long-running and autonomous loops**: the harness must be safe to leave running unattended, fanning out and (optionally) rewriting its own chain, without corrupting its own state.

In scope, and **only** these three:
- Per-tick chain re-resolution — `.flume/chain.ts` is disk-truth every tick (§2).
- A builtin chain-load gate + engine resolution-failure fallback (§3).
- Worktree create/teardown race serialization (§4).

Out of scope — still deferred, do not derive (§7 enumerates).

## 2. Per-tick chain re-resolution

Normative behavior at 0.2.0 ship:

- The chain is resolved from `.flume/chain.ts` at the **start of every tick**, not once per process. A tick that commits a rewritten `chain.ts` (new phases, handoff, writablePaths, gates) is governed by the new chain on the next tick.
- Resolution reuses the existing loader logic (`loadChain` in `cli.ts` — `tsImport` + the default/named-export interop normalization) and is **cache-busted by content hash**: the loader recompiles only when `chain.ts`'s content hash differs from the last resolution; otherwise it returns the memoized module. Content hash, not mtime — git checkouts and no-op writes touch mtime spuriously. A stable chain therefore incurs at most a hash-of-one-small-file per tick and **zero recompiles** across a loop. This is unconditional; there is no opt-in flag — it is simply the corrected semantics.
- `DispatcherOptions` no longer accepts a constructed `Chain`. The Dispatcher resolves the chain itself from `configDir` each tick. A `chainLoader?: () => Promise<ChainModule>` option is added for test injection only, defaulting to the disk resolver against `configDir`. The old `chain: Chain` input is **removed in place** — not shimmed, not retained-and-ignored (pre-1.0 clean-slate posture, `.claude/rules/spec-plan-build.md`). This removal is the §2 break that makes this a minor.
- The `agent` named export re-resolves with the chain (same module); a rewritten chain.ts may change the agent for subsequent ticks.

Acceptance:
- Within one `flume loop` process: a tick that rewrites `.flume/chain.ts` to add/rename a phase or change handoff is governed by the new chain on the immediately following tick (test: rewrite between ticks with a fake loader, assert successor scheduling reflects the new chain).
- A stable chain triggers zero recompiles across an N-tick loop (test: spy/counter on the compile step, or assert memoization by content hash).
- `Dispatcher` constructed with no prebuilt `Chain` resolves `.flume/chain.ts` from `configDir` (test: construct with only `configDir`, tick runs the on-disk chain).

## 3. Chain-load gate + engine fallback

A rewritten chain.ts can be broken (syntax error, no default export, no `phases[]`). Two layers, both required:

- **Builtin `chainLoadGate`** — exported from `src/index.ts`, added to v0.1 §2's builtin-gate list (additive, non-breaking). Declared by any chain on phases that can write `.flume/chain.ts`. On a tick that touched `.flume/chain.ts`, it validates the post-tick file loads and default-exports a valid Chain (the same checks `loadChain` makes: default export resolves, `phases` is an array). On failure the tick fails its gate → flume's existing revert path restores the commit → `chain.ts` returns to the last-good version → the loop continues. Mirrors the chain-local pending-parse gate's role, promoted to a builtin because chain.ts is universal to every flume project (unlike pending.json).
- **Engine resolution-failure fallback** — if per-tick resolution (§2) throws and no gate caught it (chain author omitted `chainLoadGate`), the engine retains the last successfully-resolved chain module for the process, emits a loud error via the logger, and continues the loop. A broken self-edit must never hard-crash a long-running loop; degraded-but-alive beats dead.

With the gate declared, the broken chain.ts never persists (the producing tick is reverted), so the next resolution succeeds against the restored file — the fallback is the net beneath the clean path, not the primary mechanism.

Acceptance:
- Tick writes a syntactically-broken `chain.ts` with `chainLoadGate` declared → that tick is reverted, `chain.ts` restored, loop continues (test).
- Resolution failure with no gate declared → engine retains last-good chain, logs an error, loop does not crash (test).

## 4. Worktree create/teardown race serialization

The fanout path mutates the shared `.git/worktrees/` metadata directory from parallel tasks. `git worktree add/remove/prune` are **not** concurrency-safe against that shared dir: one task's `git worktree remove --force` (stale-slug cleanup) can fail a sibling task's `git worktree add` mid-validation. Observed in the wild (the chaos-flume run, mitigated operationally by nuking stale state before `flume loop` — see §8).

Two race sites today:
- **Setup** — `Dispatcher.ts:257` `Promise.all(batch.map(createWorktree))`; `createWorktree` (`:517`) internally calls `git.removeWorktree` (`:527`) then add. N concurrent remove+add against `.git/worktrees/`.
- **Teardown** — `Dispatcher.ts:353` `Promise.all(... git.removeWorktree ...)` (`:369`). N concurrent `--force` removes.

The pre-wave `git.pruneWorktrees` at `Dispatcher.ts:254` is *already* serialized — the same discipline must extend to add/remove.

Normative fix: **serialize every `.git/worktrees/`-mutating git operation; keep agent fanout parallel.** Convert the setup `Promise.all` (`:257`) and the teardown `Promise.all` (`:353`) for the worktree create/remove steps to sequential `for…await`. The expensive per-entry agent invocations (`Dispatcher.ts:284`) **stay parallel** — that is the point of fanout and is unaffected (git worktree *add* is fast; the agent run is the long pole). Equivalent: a `createWorktree` mutex. `for…await` on the metadata ops is preferred over a mutex — simpler, mirrors the already-serialized prune, no lock primitive introduced. `git.ts` worktree functions are internal (not in v0.1 §2); this is a behavioral fix → CHANGELOG `### Fixed`, non-breaking.

Acceptance:
- A fanout wave of N≥2 entries where one or more slugs are stale (prior crashed run) completes without any `git worktree add` failing due to a sibling's concurrent remove (test: seed a stale `.git/worktrees/<slug>/`, run a 2-entry wave with a fake agent, assert both worktrees created and both entries shipped).
- Teardown of an N≥2 wave removes all worktrees with no `.git/worktrees/` corruption (test: assert clean `git worktree list` post-wave).
- Per-entry agent invocations still run concurrently (test: the existing fanout parallelism assertion in `Dispatcher.test.ts` stays green — the fix must not serialize agent work).

## 5. Versioning & distribution

- **0.2.0**, a minor. Governed by v0.1 §9: the `DispatcherOptions` change is a §2-breaking change → minor (not a patch), recorded in §8 not re-decided by plan.
- `CHANGELOG.md`: a `## [0.2.0]` section with `### Breaking` (DispatcherOptions: removed `chain`, resolution now per-tick from `configDir`), `### Added` (`chainLoadGate`, per-tick chain re-resolution), `### Fixed` (worktree create/teardown race serialization, §4).
- Published as `@dtmd/flume@0.2.0`; scope unchanged from v0.1 §4.
- The in-repo dogfood `.flume/chain.ts` is updated in the **same commit** as the breaking runtime change (CLAUDE.md non-negotiable). `bin/flume` is unaffected beyond the loader path already owned by `cli.ts`.

Acceptance:
- `pnpm build` clean; the v0.1 §8 CI consumer-install smoke is green with the new Dispatcher resolution (a fresh consumer's `flume status` / `flume loop` works with `DispatcherOptions` having no `chain`).
- `attw --pack . --profile esm-only` clean (v0.1 §2 — ESM-only unchanged).

## 6. Tests

Representative, not exhaustive (v0.1 §5 posture):

- `tests/Dispatcher.test.ts` (extend) — per-tick re-resolution: chain rewritten between ticks → next tick runs the new chain; stable chain → zero recompiles; construct with only `configDir` → resolves on-disk chain. Engine fallback: resolution failure with no gate → last-good retained, error logged, no throw out of `loop()`.
- `tests/Gate.test.ts` (extend) — `chainLoadGate`: valid post-tick chain passes; broken chain fails and the producing tick reverts.
- `tests/Dispatcher.test.ts` (extend) — worktree race: stale-slug seeded, N≥2 wave, all worktrees created + entries shipped; teardown leaves `git worktree list` clean; existing fanout-parallelism assertion stays green.

Acceptance: `pnpm test` exits 0; each bullet has at least one failing-if-broken test.

## 7. Non-goals for 0.2.0

Filed so plan does not derive entries for them. Still deferred (design intent in `docs/INTENT.md` / v0.1 §1, §10):

- Multi-provider `Agent` abstraction (codex/gemini/etc.). claudeCode only.
- The Docker / `SandboxProvider` seam itself. 0.2.0 ships the *primitives* a sandboxed self-modifying loop needs, not the sandbox seam.
- Session continuity / in-tick iteration / conversational agent state.
- `flume init` scaffolding.
- `flume render` arg-override.
- Dependency-aware fanout (`docs/INTENT.md` "Beyond v0.1").
- Any generalized hot-reload of other on-disk state. Baton and pending are already per-tick disk-truth and are unchanged; this doc touches the chain module only.
- A general worktree concurrency framework / lock manager. §4 is a targeted serialization of the existing metadata ops, nothing more.

## 8. Resolved decisions

For audit. Normative content lives in the sections above; this is reference.

- **Version is 0.2.0, not 0.1.3.** The clean implementation (remove the frozen-`Chain` constructor input, resolve from disk per tick) breaks v0.1 §2's `DispatcherOptions`. v0.1 §9 classifies a §2 break as a minor. The patch-preserving alternatives — an optional `chainLoader?` beside a retained `chain: Chain`, or a kept-but-ignored `chain` — are back-compat shims / misleading dead params, both forbidden by the pre-1.0 clean-slate posture. The version number is a consequence of two existing rules, not a fresh choice.
- **Worktree fix rolled into 0.2.0, not split to 0.1.3.** It is non-§2-breaking and patch-eligible on its own, but ships bundled with this minor by decision — one release, not two.
- **Recompile trigger: content hash, not mtime.** mtime is touched spuriously by git operations and no-op writes; a content hash of one small file is cheap and precise.
- **Chain-load failure: gate reverts the producing tick; engine fallback retains last-good.** A broken self-edit must not hard-crash a long-running loop. The gate is the clean path (bad commit never persists); the engine fallback is the net for chains that omit the gate.
- **`chainLoadGate` is a builtin, not chain-local.** chain.ts is universal to every flume project; the pending-parse gate is chain-local because pending.json is specific to a plan/build chain. Universal validity → builtin, additive to v0.1 §2.
- **Worktree race: serialize via `for…await`, not a mutex.** Mirrors the already-serialized pre-wave prune; introduces no lock primitive. Agent fanout stays parallel — only the `.git/worktrees/`-mutating ops serialize. Interim operational mitigation until 0.2.0 ships: consumers nuke stale worktree state before `flume loop` (the chaos-flume stopgap); the spec fix removes the need for that discipline.
