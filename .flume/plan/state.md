# State

Phase: **v0.3 line now ACTIVE** — `spec/RELEASE-v0.3.md` exists (two deliverables: foundations governor §§1-9, relocatable state §§10-15). Mode this tick: **derive** (new spec line → 5 pending entries), with an **audit** pass over the five landed commits that found a confirmed governor bug + 3 missing §7 tests. v0.1 + v0.2 lines frozen.

## This tick — derived 5 entries from RELEASE-v0.3.md; audited governor + relocatable-state commits

Both deliverables' runtime cores already landed (`ccf62c3` governor, `c34ea50` relocatable state, `20940b8` sessions chore). The spec is written largely as gap-closure; this tick decomposes the **unbuilt** remainder and the audit findings into pending.

**Audit findings (commit-delta):**
- **`ccf62c3` governor — confirmed bug.** `loadChainModule` (`src/Dispatcher.ts:160-192`) extracts `chain`+`agent` but drops `forkResolver`, though the `ChainModule` type + doc (`:121-132`) promise it as §3's stock-CLI bridge. `tick()`'s `chainModule.forkResolver ?? opts.forkResolver` can therefore never see a chain export. → **GOVERNOR-CHAIN-FORKRESOLVER**.
- **`ccf62c3` governor — §7 test gap.** Schema/seam/skip tests present; missing 3 §7 cases (predicate-flip, no-resolver≡v0.2, once-per-tick-with-repoRoot). → **GOVERNOR-TESTS**.
- **`c34ea50`/`20940b8` relocatable state — §12 canonicalization not built.** `src/cli.ts` resolves flumeDir/configDir into locals but never writes them back to `process.env`. The chore commit's session-dir change *explicitly depends* on this build-lane step. → **CLI-ENV-CANONICALIZATION** (top priority). §13 docs + §14 tests also unbuilt → **DOCS-RELOCATION**, **PROCESS-BOUNDARY-ENV-TEST**.
- CHANGELOG: governor `### Added` present (`CHANGELOG.md:48-71`); Baton `### Breaking` landed with `c34ea50`; sessions `### Fixed` folded into CLI-ENV-CANONICALIZATION. No drift filed.

**No scope creep** flagged in the landed diffs; all touch-points stayed in `src/`/tests/CHANGELOG/docs per §6 additive posture.

## Queue (5)

1. **CLI-ENV-CANONICALIZATION** (open) — §12 build lane; linchpin, dogfood chain already depends on it.
2. **GOVERNOR-CHAIN-FORKRESOLVER** (open) — §3 confirmed bug.
3. **GOVERNOR-TESTS** (open) — §7 three missing cases.
4. **PROCESS-BOUNDARY-ENV-TEST** (blockedBy CLI-ENV-CANONICALIZATION) — §14 inheritance test.
5. **DOCS-RELOCATION** (blockedBy CLI-ENV-CANONICALIZATION) — §13 README + CHAIN-AUTHORING.

All files verified against build's `writablePaths` (src/, tests/, CHANGELOG.md, README.md, docs/) — none off-allowlist.

## Active plan target

`spec/RELEASE-v0.3.md` (active). §§1-9 governor + §§10-15 relocatable state: runtime cores landed; remaining unbuilt surface is the 5 entries above. Non-goals (§8 cascade resolver / flume-on-flume self-adoption / forks.json; §14 in-repo dock glob / state migration) correctly excluded — not derived.

## Open questions

**4 (all PARKED, none closed this tick).** OQ#4 (orphaned-baton Axis-C) **updated**: v0.3 line now exists but carries governor + relocatable-state themes, **not** an Axis-C/loop-safety section — so the finding is still unauthorized by spec (no `per` cite) and stays PARKED; disposition A is now cheaper (append a section to the live RELEASE-v0.3.md rather than create the file). OQ#1 (§7a chain.ts gate-move, off-allowlist), OQ#2 (v0.1.2 worktree surface unspecced), OQ#3 (v0.1.1 tag vs CHANGELOG) — unchanged by this delta, not re-litigated.

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}`. Inbox already empty (header-only) — not modified. No off-allowlist path.
- Trunk: HEAD `20940b8`. Plan-artifact-only tick, no code change. tsc not re-run (no `src/` delta this tick).

Plan continues: no
