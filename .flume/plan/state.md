# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md` opened `d6f2632`; v0.1–v0.4 frozen). Mode this tick: **derive**.

## This tick — derive the v0.5 line (dock collapse → job verbs)

Delta = 1 spec commit (`d6f2632`: `spec/RELEASE-v0.5.md` + `docs/PRD-dock-collapse.md`), empty inbox, pending `[]`, no promotes.

**Audit**: spec commit is human-lane (spec corpus + design record; correct authorship). All source cites verified true against src: `trunkBranch` stored/defaulted at `Dispatcher.ts:277,373,385,456-457`, consumed nowhere (grep-clean); fanout branch `flume/${slug}` at `Dispatcher.ts:1100` via `git.ts addWorktree:48`; §12 write-back pattern is `resolveStateDirs` (`cli.ts:67-78`), ready to extend with `FLUME_JOB`. No drift, no findings.

**Derive**: full decomposition, 9 entries — TRUNK-PURGE (§2), JOB-RESOLUTION (§3), JOB-FANOUT-NS (§4, blockedBy RESOLUTION — real dep), JOB-NEW→RUN→RM→STATUS→EXTRACT (§5a–e, serial chain), JOB-DOCS (§8, blockedBy EXTRACT). §7 tests folded per-entry; §6 concurrency is doc-only → rides JOB-DOCS; §9/§10 non-derivable. `docs/CLI.md` enumerates commands per-section → declared on every CLI-surface entry. All paths verified inside build `writablePaths`. Serialization rationale: every verb entry touches `src/cli.ts`+`src/job.ts`; the chain (incl. JOB-NEW blockedBy JOB-FANOUT-NS, non-semantic) prevents fanout cherry-pick conflicts; TRUNK-PURGE ∥ JOB-RESOLUTION are file-disjoint and open together.

**Drain**: none (inbox empty). **Promote**: none. **Open questions**: none filed — spec is precise, cites verified, no product gaps found.

## Queue (9)

Head: **TRUNK-PURGE** + **JOB-RESOLUTION** (both open, file-disjoint). Then the blocked chain unblocks mechanically as tags ship: FANOUT-NS → NEW → RUN → RM → STATUS → EXTRACT → DOCS.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**0** — ledger empty.

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md}`; open-questions.md untouched (empty ledger); inbox.md untouched (empty). All entry file paths verified against build `writablePaths` (README.md, docs/**, src/**, tests/** all covered).
- Trunk: HEAD `d6f2632` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 1 of origin/main** (`d6f2632` unpushed) — human push pending.

Plan continues: no
