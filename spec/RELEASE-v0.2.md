# Flume — v0.2.0 Release Target

The human-directed ship target for the 0.2.0 minor — owned by the human, edited in interactive sessions under explicit direction, never by an autonomous phase. Plan derives pending entries against this; build executes them. When something here is ambiguous, the answer goes through `.flume/plan/open-questions.md` → human edit of this file → next plan tick.

This is a release-readiness doc, not a design doc. Design intent lives in `docs/INTENT.md`. `spec/RELEASE-v0.1.md` stays frozen as the v0.1-line target; its §2 (public surface) and §9 (versioning policy) remain governing — this doc *adds to* that surface (`chainLoadGate`, the gate-feedback context), *breaks* it (`DispatcherOptions`), and *fixes behavior behind* it (worktree serialization, fanout revert isolation, plan-prose durability). The §2 break is why this is a minor per v0.1 §9, not a patch.

Status: **READY FOR PLAN.** All design questions resolved. Sections below are normative for plan derivation.

## 1. Purpose & scope

0.2.0 is **dispatcher correctness for long-running and autonomous loops**: the harness must be safe to leave running unattended — fanning out, retrying, and (optionally) rewriting its own chain — without corrupting its own state, silently discarding work, or looping blind.

The unifying defect this release closes: **the loop around revert is amnesiac.** Revert itself is mechanically sound (`git reset` before push). The footgun is that a reverted tick forwards no signal — only `{gate, ok, message}` reaches the next tick, gate `details` go to dispatcher stdout, and the reset erases the SHA so `git log` (the prompt's only state channel) shows nothing happened. Every retry restarts cold; the same wall is re-derived N times. §5–§8 target that blindness, not the revert primitive.

In scope:
- Per-tick chain re-resolution — `.flume/chain.ts` is disk-truth every tick (§2).
- A builtin chain-load gate + engine resolution-failure fallback (§3).
- Worktree create/teardown race serialization (§4).
- Gate-failure feedback into the retrying tick (§5).
- No-commit outcome taxonomy (§6).
- Fanout revert isolation + gate-placement defaults (§7).
- Plan-tick prose durability (§8).

Out of scope — still deferred, do not derive (§11 enumerates).

## 2. Per-tick chain re-resolution

Normative behavior at 0.2.0 ship:

- The chain is resolved from `.flume/chain.ts` at the **start of every tick**. A tick that commits a rewritten `chain.ts` (new phases, handoff, writablePaths, gates) is governed by the new chain on the next tick — including a `chain.ts` change that rides a same-commit `src/` change (CLAUDE.md non-negotiable: breaking runtime changes update `chain.ts` in the same commit).
- **Mechanism: each tick is a fresh OS process.** `flume loop` is a supervisor that spawns one `flume tick` child process per iteration; the chain is resolved once, in that child, at tick start. In-process re-resolution of a rewritten `chain.ts` is **impossible** on the supported toolchain and is not attempted: Node's ESM module registry is keyed by resolved URL and is non-evictable, so a fixed-path `chain.ts` is pinned to its first evaluation for the life of a process — no content-hash query string, `tsx`/`tsImport` namespace, or loader re-registration evicts it (verified empirically on the pinned toolchain, tsx 4.21 / Node 22.21). An in-process loader also could not pick up a `chain.ts` whose behavior moved into a same-commit `src/` change, since those dependency modules are already evaluated. A process boundary is the only mechanism that re-evaluates the whole graph; it is therefore *the* mechanism, not an optimization. This aligns §2 with §11's standing invariant ("each tick remains a fresh process") and CLAUDE.md's stateless-tick / disk-is-truth posture.
- The supervisor carries **no in-memory chain or phase state across ticks**: continuation and hibernation are read after each child tick from disk baton state (disk-is-truth), or from the child's exit signal — build chooses the channel against the acceptance below. `--max N` and hibernation are unchanged in observable behavior (the loop stops at hibernation or N ticks); only the per-iteration boundary becomes a process boundary.
- Per-tick cost is one chain compile per tick (one small `tsImport` of `chain.ts`), dominated by orders of magnitude by the tick's agent invocation. There is **no in-process recompile to memoize and no cache-bust** — the prior content-hash-memoization design is removed: it was an in-process optimization for a mechanism that cannot deliver the guarantee.
- `DispatcherOptions` no longer accepts a constructed `Chain`. `Dispatcher.tick()` resolves the chain itself from `configDir` in its own process. A `chainLoader?: () => Promise<ChainModule>` option is added for **in-process test injection only** (unit tests call `tick()` directly — no subprocess), defaulting to the disk resolver against `configDir`. The old `chain: Chain` input is **removed in place** — not shimmed, not retained-and-ignored (pre-1.0 clean-slate posture, `.claude/rules/spec-plan-build.md`). This removal is the §2 break that makes this a minor.
- The `agent` named export re-resolves with the chain (same module, same fresh process); a rewritten chain.ts may change the agent for subsequent ticks.

Acceptance:
- A **real on-disk** `.flume/chain.ts`, rewritten between two **real `flume tick` subprocess invocations** (add/rename a phase or change handoff), governs the second tick: the second `flume tick` process schedules per the new chain (integration test: spawn `flume tick` twice against a real chain.ts mutated on disk between them — **not** a fake loader; the fake-loader path cannot exercise the process-boundary guarantee and is explicitly insufficient for this bullet).
- `flume loop` spawns exactly one `flume tick` process per iteration and carries no in-memory chain/phase state across them; hibernation and `--max N` still terminate the loop (test: loop over a stub tick, assert one child process per iteration and correct termination).
- `Dispatcher` constructed with no prebuilt `Chain` resolves `.flume/chain.ts` from `configDir` (in-process unit test: construct with only `configDir`, `tick()` runs the on-disk chain — no subprocess).

## 3. Chain-load gate + engine fallback

A rewritten chain.ts can be broken (syntax error, no default export, no `phases[]`). Two layers, both required:

- **Builtin `chainLoadGate`** — exported from `src/index.ts`, added to v0.1 §2's builtin-gate list (additive, non-breaking). Declared by any chain on phases that can write `.flume/chain.ts`. On a tick that touched `.flume/chain.ts`, it validates the post-tick file loads and default-exports a valid Chain (the same checks `loadChain` makes). On failure the tick fails its gate → flume's revert path restores the commit → `chain.ts` returns to the last-good version.
- **Engine resolution-failure fallback** — if per-tick resolution (§2) throws and no gate caught it, the `flume tick` process exits with a loud logged error and a no-work failed-tick outcome; the `flume loop` supervisor does not crash and proceeds to the next iteration. Under process-per-tick there is **no in-process "last-good chain" to retain** — recovery is structural: a broken `chain.ts` is reverted by `chainLoadGate` and the next tick's fresh process reads the restored file; an *ungated* broken `chain.ts` makes every subsequent tick fail loudly until a human or a §5-informed retry restores it. The §3 containment guarantee (no supervisor crash, no bad persist) is unchanged; the retain-last-good-in-process mechanism is removed as moot under the corrected architecture.

**This section is only self-healing in conjunction with §5.** Without gate-failure feedback, a tick that writes a broken chain.ts is reverted, the next tick can't see why, rewrites it the same way, and the loop reverts forever while looking alive — the package-json-×15 pattern with chain.ts as the file. The §3 "loop continues" guarantee is *containment* (no crash, no bad persist); it becomes *recovery* only because §5 forwards the failure. Build must implement §3 and §5 together; a §3 entry that ships without §5 is incomplete by this spec.

Acceptance:
- Tick writes a syntactically-broken `chain.ts` with `chainLoadGate` declared → that tick is reverted, `chain.ts` restored, loop continues, **and the next tick's prompt carries the chain-load failure detail per §5** (test).
- Resolution failure with no gate declared → the `flume tick` process fails loudly with a no-work outcome, the supervisor logs and does not crash, the loop proceeds to the next tick (test).

## 4. Worktree create/teardown race serialization

The fanout path mutates the shared `.git/worktrees/` metadata directory from parallel tasks. `git worktree add/remove/prune` are **not** concurrency-safe against that shared dir: one task's `git worktree remove --force` (stale-slug cleanup) can fail a sibling task's `git worktree add` mid-validation. Observed in the wild (the chaos-flume run, mitigated operationally by nuking stale state before `flume loop` — see §12).

Two race sites today:
- **Setup** — `Dispatcher.ts:257` `Promise.all(batch.map(createWorktree))`; `createWorktree` (`:517`) internally calls `git.removeWorktree` (`:527`) then add. N concurrent remove+add against `.git/worktrees/`.
- **Teardown** — `Dispatcher.ts:353` `Promise.all(... git.removeWorktree ...)` (`:369`). N concurrent `--force` removes.

The pre-wave `git.pruneWorktrees` at `Dispatcher.ts:254` is *already* serialized — the same discipline must extend to add/remove.

Normative fix: **serialize every `.git/worktrees/`-mutating git operation; keep agent fanout parallel.** Convert the setup `Promise.all` (`:257`) and the teardown `Promise.all` (`:353`) for the worktree create/remove steps to sequential `for…await`. The expensive per-entry agent invocations (`Dispatcher.ts:284`) **stay parallel**. Equivalent: a `createWorktree` mutex; `for…await` is preferred — simpler, mirrors the already-serialized prune, no lock primitive. `git.ts` worktree functions are internal (not in v0.1 §2); behavioral fix → CHANGELOG `### Fixed`.

Acceptance:
- A fanout wave of N≥2 with one or more stale slugs completes without any `git worktree add` failing due to a sibling's concurrent remove (test: seed a stale `.git/worktrees/<slug>/`, 2-entry wave, fake agent, both worktrees created + both entries shipped).
- Teardown of an N≥2 wave leaves `git worktree list` clean (test).
- Per-entry agent invocations still run concurrently (test: the existing fanout-parallelism assertion stays green).

## 5. Gate-failure feedback to the retrying tick

The highest-leverage change in this release; closes the blindness loop (§1). Today `Dispatcher` forwards only `{gate, ok, message}` to the next tick's context, captures gate `details` to dispatcher stdout only, and `git reset`s the reverted SHA out of existence — so a retry's only state channel (`git log`) shows nothing, and the agent re-derives the same wall every attempt (package-json-hygiene ×15; corpus-config-example ×8). This is the unaddressed upstream ask flume already filed against itself.

Normative behavior:
- When a tick's commit is **reverted by a gate**, the next tick scheduled for that same entry (fanout) or phase (singleton) receives, **in its rendered prompt**, a prior-attempt block: (a) that a previous attempt was made and reverted, (b) the failing gate's `name` and full `details` (not just `message`), (c) a digest of the reverted attempt (the diff or a stat summary) so the agent does not blindly reconstruct.
- **Cross-process by construction.** Per §2 the next tick is a fresh process with no in-memory carry; the prior-attempt block is persisted to disk by the supervisor/dispatcher (alongside baton state, disk-is-truth) and read by the next `flume tick` at prompt render. An in-memory handoff is architecturally impossible — build must not assume one.
- Symmetric across `afterCommit` **and** `afterMerge`. `afterMerge` currently surfaces nothing to the agent; it must forward the same prior-attempt block. The `afterMerge` failure detail dying with the dispatcher process (07:11Z bcrypt — agent reported success, kill invisible) is the explicit anti-pattern this closes.
- The prior-attempt block is part of the prompt-template surface; `prompts/build.md` (and `prompts/plan.md`) gain a documented slot for it. The slot is empty on a first attempt.
- The forwarded context is bounded (a digest, not unbounded diff dumps) per the telegraphic-prose discipline — enough to not re-derive, not a transcript.

Acceptance:
- Fake gate fails with structured `details` at `afterCommit` → the next tick's *rendered prompt* contains the gate name, the details, and a prior-attempt marker (test against the render path + fake agent).
- Same at `afterMerge` (test) — explicitly, because today this path is silent.
- First attempt for an entry → the prior-attempt slot is empty/absent (test: no false signal).

## 6. No-commit outcome taxonomy

≈23% of completed turns in a 39-hour autonomous run produced no commit (~8.7 LLM-hours), and the dispatcher conflates three causally-distinct modes — so retries can't tell what happened and platform failures masquerade as agent failures.

Normative behavior:
- A no-commit tick is classified as exactly one of: **gate-revert** (a commit was made then reverted by a gate), **voluntary-bail** (the agent exited cleanly without committing — e.g. a writablePaths/Rule-0 conflict it refused to cross), **platform-preempt** (the agent process failed for non-work reasons — rate-limit, auth, timeout, dispatcher-killed).
- The classification is surfaced (a) into `TickOutcome` / the trajectory or logger record, and (b) into the next-tick prior-attempt block per §5 ("last attempt: voluntary-bail at <constraint>" reads differently from "gate-revert: <gate> <details>" reads differently from "platform-preempt: retried, no work signal").
- `voluntary-bail` loops (corpus-config-example: five consecutive sessions bailing at the same writablePaths wall) and `platform-preempt` runs (17 sessions, rate-limit) must be distinguishable in the record without reading session logs.

Acceptance:
- Three tests, one per mode, asserting the distinct classification on `TickOutcome` and in the §5 forward block.
- A voluntary-bail followed by a retry → the retry's prompt names the prior bail and its constraint (test).

## 7. Fanout revert isolation + gate-placement defaults

Two coupled fanout defects, plus the gate-design lesson.

**(a) Gate placement.** Expensive correctness gates (e.g. `vitestGate`) running at `afterCommit` under fanout are a contention trap: N parallel heavy gates saturate CPU, flaky timeouts revert clean commits (07:11Z bcrypt fan-out — assertions blew vitest's 5s timeout under contention, killed three clean commits). Normative: the dogfood `.flume/chain.ts` places expensive correctness gates at `afterMerge` and cheap structural gates (`tscGate`, bundle self-containment) at `afterCommit`; `docs/CHAIN-AUTHORING.md` documents this as the default guidance with the contention rationale.

**(b) afterMerge revert isolation.** Today an `afterMerge` gate failure reverts the whole wave (`hardResetTo(preHead)`, blast-radius-N): one flaky entry kills N−1 clean commits and the retry wave starts cold (17:05Z → 17:16Z, three clean commits reverted by one flaky merge-time run, retry wave aborted in cross-wave amnesia). Normative: an `afterMerge` gate failure reverts **only the offending entry's commit**; its N−1 clean siblings stay shipped. The offending entry stays pending and its retry carries the §5 prior-attempt block. This is the heaviest item in the release — it changes merge/revert granularity, not a parameter.

**(c) Gate-design lesson (docs, not runtime).** Byte-exact gating fired on functionally-identical artifacts and reverted clean commits (`bundleFreshnessGate`: pnpm virtual-store hashes leaked into esbuild output, 257± pure-reorder diffs; the real property lived in `bundleSelfContainmentGate`). The offending gate was a *consumer* chain gate, so flume's lever is teaching, not a runtime change: `docs/CHAIN-AUTHORING.md` gains a "gate on the safety property, never on byte-equality of generated artifacts" anti-pattern with this as the worked example.

Acceptance:
- (a) `.flume/chain.ts` has expensive correctness gates at `afterMerge`, structural at `afterCommit`; `CHAIN-AUTHORING.md` documents the default + rationale.
- (b) Fanout wave N≥2, one entry's `afterMerge` gate fails → only that entry reverts and stays pending; the other N−1 stay shipped; the existing parallelism assertion stays green (test).
- (c) `CHAIN-AUTHORING.md` contains the byte-equality anti-pattern section.

## 8. Plan-tick prose durability

A reverted plan tick destroys externally-invisible findings: the prose it wrote to `state.md` / `open-questions.md` in the same commit is lost when the commit is reset, recoverable only by a human reading session logs (`pendingParseGate` reverting `5f4b583` lost CLI-SEARCH-WALK + skill-path findings; reconstructed by hand in `9432489`).

Normative behavior: a gate-reverted plan tick must not silently destroy its prose. Either the plan-prose artifacts survive the revert (the revert scopes to the machine-checkable artifact that failed, e.g. `pending.json`, not the prose), **or** the prior tick's prose is carried into the next plan tick via the §5 forward block. Recovery must never require reading session logs. Build chooses the mechanism against this acceptance; the spec mandates the property (no silent prose loss), not the implementation.

Acceptance:
- A plan tick writes findings to `open-questions.md`/`state.md` and a `pending.json` that fails `pendingParseGate` → after revert, the findings are still recoverable without session logs: present on disk OR in the next plan tick's prior-attempt block (test).

## 9. Versioning & distribution

- **0.2.0**, a minor. Governed by v0.1 §9: the `DispatcherOptions` change (§2) is the only §2-breaking change → minor. Everything else is additive or behavioral.
- `CHANGELOG.md` `## [0.2.0]`:
  - `### Breaking` — `DispatcherOptions`: removed `chain`, resolution now per-tick from `configDir` (§2).
  - `### Added` — `chainLoadGate` (§3); per-tick chain re-resolution (§2); gate-failure prior-attempt context surfaced to the retrying tick (§5); no-commit outcome taxonomy on `TickOutcome` (§6).
  - `### Fixed` — worktree create/teardown race (§4); `afterMerge` wave-revert blast-radius (§7b); silent plan-prose loss on revert (§8).
  - `### Changed` — dogfood gate placement: expensive correctness gates → `afterMerge` (§7a); `flume loop` is now a supervisor spawning one `flume tick` process per iteration (process-per-tick, §2) — observable `--max`/hibernation behavior unchanged.
- Published as `@dtmd/flume@0.2.0`; scope unchanged from v0.1 §4.
- The in-repo dogfood `.flume/chain.ts` is updated in the **same commit** as the breaking runtime change (CLAUDE.md non-negotiable). `cli.ts`/`bin/flume` **is** affected: `flume loop` becomes a supervisor that spawns `flume tick` per iteration (§2), so the loop subcommand re-execs the binary; `flume tick` itself remains a single-process resolve-and-run.

Acceptance:
- `pnpm build` clean; the v0.1 §8 CI consumer-install smoke green with the new Dispatcher resolution.
- `attw --pack . --profile esm-only` clean (v0.1 §2 — ESM-only unchanged).

## 10. Tests

Representative, not exhaustive (v0.1 §5 posture):

- `tests/Dispatcher.test.ts` (extend) — §2 in-process cases (`tick()` resolves from `configDir`; `loop` spawns one `flume tick` per iteration + termination, via a stubbed spawn); §3 engine fallback; §5 prior-attempt block at afterCommit and afterMerge + empty on first attempt; §6 three-mode classification; §7b per-entry afterMerge isolation + parallelism unchanged; §8 plan-prose recoverable post-revert.
- §2 process-boundary reload — an **integration test** that spawns `flume tick` twice against a real on-disk `.flume/chain.ts` mutated between invocations, asserting the second tick runs the new chain. Not a `Dispatcher` unit test; the fake-loader path cannot exercise this.
- `tests/Gate.test.ts` (extend) — `chainLoadGate`: valid passes, broken fails and reverts.
- Worktree race (§4) — stale-slug seeded, N≥2 wave, all created + shipped; teardown leaves `git worktree list` clean.

Acceptance: `pnpm test` exits 0; each §-acceptance bullet above has at least one failing-if-broken test.

## 11. Non-goals for 0.2.0

Filed so plan does not derive entries for them. Still deferred (design intent in `docs/INTENT.md` / v0.1 §1, §10):

- Multi-provider `Agent` abstraction. claudeCode only.
- The Docker / `SandboxProvider` seam itself. 0.2.0 ships the *primitives* a sandboxed self-modifying loop needs, not the sandbox seam.
- Session continuity / in-tick iteration / conversational agent state. (§5 forwards a *bounded digest* between ticks — it is not session continuity; each tick remains a fresh process.)
- `flume init` scaffolding; `flume render` arg-override.
- Dependency-aware fanout (`docs/INTENT.md` "Beyond v0.1").
- Generalized hot-reload of other on-disk state. Baton and pending are already per-tick disk-truth; this doc touches the chain module only.
- A general worktree concurrency framework / lock manager. §4 is targeted serialization, nothing more.
- Reconstructing *git-erased* reverted SHAs. §5 forwards failure context to the next tick; it does not preserve reverted commits in git history.

## 12. Resolved decisions

For audit. Normative content lives above; this is reference.

- **The footgun is blindness, not revert.** Revert is mechanically sound (`git reset` pre-push). The unsoundness is the amnesiac loop around it — no failure signal forwarded, SHA erased, `git log` the only state channel. §5–§8 target the blindness; the revert primitive is unchanged. Evidenced by a 39-hour / 8,825-turn autonomous-run forensic; the originating analysis lives in this round's conversation and commit body, not duplicated here.
- **§3 + §5 ship together.** A chainLoadGate without gate-feedback reproduces the blind revert loop for chain.ts. Plan must not derive §3 as independently shippable.
- **(v) is delivered as docs, not runtime.** The byte-equality offender was a consumer chain gate; flume's only lever is teaching gate design (§7c → `CHAIN-AUTHORING.md`). Not a Dispatcher change — do not derive a runtime entry for it.
- **§7b is the heaviest item, by decision.** Per-entry `afterMerge` revert isolation changes merge/revert granularity, not a parameter. Bundled into 0.2.0 deliberately: all of §5–§8 are one coherent theme (the dispatcher is unsafe for long autonomous/fanout runs); splitting it leaves autonomous flume footgunned across releases. Sized honestly so derivation does not under-scope it.
- **Version is 0.2.0, not 0.1.3.** The §2 `DispatcherOptions` removal breaks v0.1 §2; v0.1 §9 classifies a §2 break as a minor. Patch-preserving shims are forbidden by the pre-1.0 clean-slate posture. The number is a consequence of two existing rules.
- **Per-tick reload is a process boundary, not in-process re-eval.** Node's ESM module registry is keyed by resolved URL and is non-evictable; a fixed-path `chain.ts` is pinned to its first evaluation for a process's life, and no content-hash query string / `tsImport` namespace / loader re-registration evicts it (verified empirically on the pinned toolchain, tsx 4.21 / Node 22.21; the plain-`import()` control proves it is a Node-ESM constraint, not a `tsx` bug). In-process reload also cannot pick up a `chain.ts` whose change rode a same-commit `src/` change, since those modules are already evaluated. The earlier "reuse `loadChain` + content-hash cache-bust, in-process" mechanism was therefore unimplementable as written; `flume loop` spawning `flume tick` per iteration is the only correct mechanism and aligns with §11's standing fresh-process invariant. The superseded "recompile trigger: content hash, not mtime" decision is moot — there is no in-process recompile to trigger.
- **`chainLoadGate` is a builtin, not chain-local.** chain.ts is universal to every flume project; pending-parse is chain-local because pending.json is plan/build-specific.
- **Worktree race: serialize via `for…await`, not a mutex.** Mirrors the already-serialized prune; no lock primitive. Interim mitigation until 0.2.0 ships: consumers nuke stale worktree state before `flume loop`.
