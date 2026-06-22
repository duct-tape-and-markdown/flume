# State

Phase: **v0.3 line ACTIVE** — `spec/RELEASE-v0.3.md` (foundations governor §§1-9, relocatable state §§10-15). Mode this tick: **audit** — all 5 derived entries shipped since last plan; cross-checked the 7 commits against their cited sections. v0.1 + v0.2 frozen.

## This tick — audited the 5 shipped entries; filed 1 §12 doc-comment gap

Delta: 7 commits since `1878ed7` (the 5 pending entries built + 2 chore drains). pending was drained to `[]`. No spec delta, inbox empty, nothing blockedBy to promote. Pure audit tick.

**Audit dispositions (commit-delta):**
- **`3178f75` GOVERNOR-CHAIN-FORKRESOLVER (§3)** — clean. `loadChainModule` surfaces `forkResolver` via the same ns/interop path as `agent`, exercised through a real on-disk chain.ts. Closes the §3 confirmed bug.
- **`b9732cd` GOVERNOR-TESTS (§7)** — clean. All three §7 cases present (predicate-flip two-tick, no-resolver≡v0.2, once-per-tick-with-repoRoot). Tests-only.
- **`ef112ce` CLI-ENV-CANONICALIZATION (§12)** — runtime half clean (`resolveStateDirs` seam writes back absolute roots, entrypoint guard, seam tests). **One §12 sub-clause missed** → filed **SESSION-PLACEMENT-DOCCOMMENT**: §12's last paragraph asks the `src/Dispatcher.ts` doc comment be *verified + clarified that placement is chain-supplied*; the commit scoped only cli.ts/CHANGELOG/tests. Comment at `:43-44` still lists `<flumeDir>/sessions/` flat beside runtime-placed `awake/`+`prior-attempts/`.
- **`1152671` PROCESS-BOUNDARY-ENV-TEST (§14)** — clean. Real `flume loop --max 1` case writes the child-observed roots to disk; inheritance proven end-to-end (no `env:` override on `defaultTickRunner`).
- **`7377932` DOCS-RELOCATION (§13)** — clean. README relocation section + CHAIN-AUTHORING chain-author requirement match §13; no .gitignore change (dock out-of-tree).

**No scope creep** in any diff — all touched src/, tests/, CHANGELOG, README, docs/ per build's `writablePaths`. No gate-bypass.

**Correction vs. prior reverted attempt (`860ba5c`):** it re-added PROCESS-BOUNDARY-ENV-TEST + DOCS-RELOCATION as `open` (they have since shipped — not re-added here) and filed the doc-comment finding with a 207-char summary (reverted by `pendingParseGate`). This tick files only the still-valid finding, summary 162 chars.

## Queue (1)

1. **SESSION-PLACEMENT-DOCCOMMENT** (open) — §12 doc-comment clarification; src/Dispatcher.ts, build-writable.

## Active plan target

`spec/RELEASE-v0.3.md`. §§1-9 governor + §§10-15 relocatable state: runtime cores + the 5 gap-closure entries all shipped. Only residue is the §12 doc-comment clause above. Non-goals (§8 cascade/self-adoption/forks.json; §14 in-repo dock glob / state migration) correctly excluded.

## Open questions

**4 (all PARKED, none touched this delta).** OQ#1 (§7a chain.ts gate-move, off-allowlist), OQ#2 (v0.1.2 worktree surface unspecced), OQ#3 (v0.1.1 tag vs CHANGELOG), OQ#4 (orphaned-baton Axis-C). None implicated by this audit delta; not re-litigated.

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md}`. open-questions + inbox unchanged. No off-allowlist path. SESSION-PLACEMENT-DOCCOMMENT touches src/Dispatcher.ts — inside build's `writablePaths`.
- Trunk: HEAD `9936ee2`. Plan-artifact-only tick. tsc not re-run (no src/ delta this tick).

Plan continues: no
