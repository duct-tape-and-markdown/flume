# State

Phase: **v0.4 ACTIVE** (`spec/RELEASE-v0.4.md` opened `d2371fe`; v0.1/v0.2/v0.3 frozen). Mode this tick: **audit**.

## This tick — audit the first v0.4 ship wave (3 build commits + chore drain)

Delta = 4 commits since `edf2051`, no spec change, empty inbox, no blocked entries.

- `1749b94` **AXIS-C-ORPHANED-AWAKE vs §3: conformant.** All four mandates verified at source — typed `terminal` sibling (`src/Dispatcher.ts` `TerminalMisconfiguration`), exit 78 via `tickExitCode` seam (`src/cli.ts`), `superviseLoop` stop on exit code alone (flags read only to *name* orphans), flags left on disk. §7 §3 matrix fully tested (unit + real-subprocess integration) plus a mixed-flag case. Two beyond-letter calls **RATIFIED**: `flume loop` propagates 78 (`SuperviseResult.terminal`); terminal only when *every* awake flag orphaned (mixed → declared phase runs, orphan classified at quiescence). Both → new OQ (NEEDS AMENDMENT — two one-line §3 additions). Test-harness fixes (tsx via `node cli.mjs`, `hermeticEnv` FLUME_DIR scrub) accepted: §6-aligned, in-lane, closed a real hermeticity escape (stray child ran against this repo's live `.flume`).
- `9ac9d61` **DOCS-PR5-SURFACE vs §2c: conformant.** All three mandated items (FLUME_WORKTREES_DIR, loop lock, `{extraEnv}` seam) + residual §2a gaps (revertedTags/observedFiles/wave auto-unblock) + stale worktree-layout fix; edits confined to declared README/CHAIN-AUTHORING. Verified the agent-only extraEnv claim at `src/Dispatcher.ts:995`. **FINDING → `FIX-EXTRAENV-JSDOC-SCOPE`**: `src/Phase.ts:164-174` JSDoc still claims gates see extraEnv, contradicting §2b's recorded semantics.
- `8f708d4` **CI-WINDOWS-LANE vs §6/§8: shape conformant** (single windows-latest lane, separate tsc/test steps, no matrix, publish-acceptance stays ubuntu). Acceptance "green" **UNVERIFIABLE**: origin/main = `cdfe399` — trunk is 10 commits ahead unpushed, the lane has never run, and the last pushed run is red (ubuntu Consumer-install smoke, pre-PR#5-era). **Human action: push main** to exercise the lane + post-reconciliation suite.
- `9735347` chore drain: removed exactly the 3 shipped tags; `dependsOnForks: []` + reformat are harness-side; clean.

**Derive**: 1 entry from the audit finding (`FIX-EXTRAENV-JSDOC-SCOPE`, per §2b, comment-only, build-writable `src/`). **Drain**: none (inbox empty). **Promote**: none (no blockedBy gates).

## Queue (4)

Head: `ENTRY-SCOPED-GUARD`. Then `PHASE-AGENT`, `TEST-PR5-SURFACE`, `FIX-EXTRAENV-JSDOC-SCOPE`. All open, no gates.

## Active plan target

`spec/RELEASE-v0.4.md` — decomposition current; underived surface: none. 3 of 6 original v0.4 entries shipped this wave; §3 done, §2c docs done, §6 lane authored (CI proof pending push).

## Open questions

**3**: §7a gate-move (PARKED, `chore(flume):`), v0.4-§5 dogfood adoption (PARKED, after `ENTRY-SCOPED-GUARD`), §3 loop-78/mixed-flag recording (NEEDS AMENDMENT, new this tick — rulings made, spec edit optional but closes it).

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}`. inbox.md untouched (empty). All on-allowlist; `FIX-EXTRAENV-JSDOC-SCOPE` targets `src/` (build-writable ✓).
- Trunk: HEAD `9735347` at tick start, tree clean. **origin/main 10 behind** — windows lane and all post-PR#5 fixes unexercised in CI until the human pushes.

Plan continues: no
