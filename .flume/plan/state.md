# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — heaviest delta dimension is the `build:` commit `4a79a6b` (CHAIN-AUTHORING-RELOAD-DOCS), shipped by harness `c0fd3ab`. No spec delta (no derive); inbox empty (no drain). One mechanical promote.

## Audit — `4a79a6b` (build: scrub content-hash-memo narrative from CHAIN-AUTHORING.md)

Cross-checked the diff against `spec/RELEASE-v0.2.md` §2 (the entry's `per` cite) and the entry's declared scope. **Conformant; nothing routed.**

- **Scope** — exactly the one declared file `docs/CHAIN-AUTHORING.md`, the two declared regions (the "Where the chain lives" para + the Dispatcher-wiring code-comment). 11 insert / 7 delete, within build's `docs/**` writablePaths. No code/schema/test touched; entry correctly declared `tests: []`. No creep.
- **§2 conformance** — both passages now mirror §2's normative language: process boundary is *the* mechanism, not an optimization (§2 bullet 2); one `tsImport` of `chain.ts` per tick, dominated orders of magnitude by the agent invocation (§2 bullet 4); the prior content-hash-memoization design is removed, no in-process recompile/cache-bust (§2 bullet 5). Faithful — neither over- nor under-stated vs. the spec.
- **Acceptance met** — no content-hash/memoization/zero-recompile *claim* survives; the only two residual grep hits ("no in-process memoization or cache-bust", "no in-process memo or cache-bust") are explicit negations matching §2 verbatim. Docs-only → `pnpm test` unaffected; build ran gates per CLAUDE.md non-negotiables (plan investigates, does not re-run gates).
- **No gate-bypass** — `c0fd3ab` is the normal harness ship-removal of the entry from pending.json (pure 23-line deletion, nothing else).

**Accepted as debt (no entry):** none new. The two prior-tick debt notes (stale "shifts after upstream entries" line-hints; no end-to-end real-subprocess `flume loop` test) are about e2959d2/LOOP-PROCESS-PER-TICK, already audited conformant last tick — not re-litigated; the line-hints are explicitly-fragile pointers per the field-discipline rule, re-pointing them every tick is the bloat-tax that rule warns against.

## Promote — mechanical

- **GATE-FAILURE-FEEDBACK**: was `blockedBy CHAIN-AUTHORING-RELOAD-DOCS`; that tag shipped (`c0fd3ab`) and left `pending-now`. Flipped to `gate: { kind: "open" }` — it is now the queue head. Its `files`/`notes` need no change: CHAIN-AUTHORING-RELOAD-DOCS only scrubbed the memo narrative; the `<harness>`-block doc section the §5 entry mirrors/extends is untouched, and notes carry no shipped-tag reference.
- No other entry's `blockedBy` gate references a now-absent tag — each remaining entry blocks on the one directly above it, all still pending. No further promotes.

## Queue (7 entries, linear chain, one open head)

`GATE-FAILURE-FEEDBACK` (open, §5 keystone — NEW head; unblocks §6/§7b/§8) → NO-COMMIT-TAXONOMY (§6) → AFTERMERGE-REVERT-ISOLATION (§7b, heaviest) → PLAN-PROSE-DURABILITY (§8) → WORKTREE-RACE-SERIALIZE (§4) → CHAIN-AUTHORING-GATE-GUIDANCE (§7a/§7c docs) → RELEASE-0.2.0 (§9).

## Open questions

- **3**, all unchanged this tick (no spec delta, no commit touched these surfaces, no human input arrived — not re-litigated per collaboration rule):
  1. §7a dogfood `.flume/chain.ts` gate-placement move — off build's writablePaths + builtin `when` affordance gap; gated on §7b (PARKED; rec A: post-§7b `chore(flume):` move).
  2. Unspecced published worktree-hook surface (`teardownWorktree`/`WorktreeSetupResult`/`extraEnv`) — v0.2 rewrite still didn't fold it in (PARKED — NEEDS AMENDMENT; rec A).
  3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec A).
- OQ#1 (§2 in-process reload mechanism) remains CLOSED — resolved `4187f44` → LOOP-PROCESS-PER-TICK, shipped + audited conformant; the doc-drift it spun off (CHAIN-AUTHORING-RELOAD-DOCS) is now also shipped + audited conformant this tick.

## Writable-paths / trunk

- No entry touched this tick beyond the mechanical gate flip on GATE-FAILURE-FEEDBACK (in-place in pending.json, a plan writable path). GATE-FAILURE-FEEDBACK's declared targets (`src/Dispatcher.ts`, `src/Prompt.ts`, `docs/CHAIN-AUTHORING.md`, `.gitignore`, `tests/Dispatcher.test.ts`) were previously verified within build's writablePaths; the §5-block-as-structural-injection (mirroring `<harness>`) keeps it fully build-writable — no off-allowlist piece, no new OQ.
- Trunk: HEAD `c0fd3ab`. `4a79a6b` is a `build:` commit → landed only after green tscGate+vitestGate per CLAUDE.md non-negotiables. No code change this tick (plan-artifact-only).

Plan continues: no
