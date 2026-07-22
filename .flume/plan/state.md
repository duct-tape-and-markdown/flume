# State

Phase: **v0.4 ACTIVE** (`spec/RELEASE-v0.4.md` opened `d2371fe`; v0.1/v0.2/v0.3 frozen; 0.3.1 cut `135a8d7`). Mode this tick: **derive**.

## This tick — derive v0.4 (full spec decomposition + delta audit)

Delta = new `spec/RELEASE-v0.4.md` (spec-delta), 9 commits (PR #5 reconciliation merges + fixes, 0.3.1 cut, the spec commit), empty inbox, empty pending.

**Derive** (`RELEASE-v0.4.md` §§2c-6 → 6 entries, all `open`):
- `AXIS-C-ORPHANED-AWAKE` (§3): `TickOutcome.terminal`, exit 78, `superviseLoop` fail-fast on child 78, flag stays on disk.
- `ENTRY-SCOPED-GUARD` (§5): entry-scoped fanout guard + `Phase.entryChannelPaths`; enforced, no warn-first.
- `PHASE-AGENT` (§4): `Phase.agent` seam, resolution `phase.agent ?? chainModule.agent ?? opts.agent`.
- `TEST-PR5-SURFACE` (§2c): loop-lock + `FLUME_WORKTREES_DIR` test backfill (verified: zero test refs today).
- `DOCS-PR5-SURFACE` (§2c): README/CHAIN-AUTHORING for worktree override, loop lock, `{extraEnv}`.
- `CI-WINDOWS-LANE` (§6): windows-latest job in `ci.yml`.
No blockedBy edges — entries independent; file overlap on `src/Dispatcher.ts`/`Phase.ts`/tests lets partition serialize waves. §7 tests folded into each entry's `tests[]`; §8 non-goals respected (no `Phase.model`, no CI matrix).

**Audit** (PR #5 delta `93c852a`..`135a8d7`): out-of-band fork-reconciliation surface, recorded (not re-derived) by §2 — verified each §2a claim at source: worktree base `src/Dispatcher.ts:1032` (`resolve(env) : join(flumeDir,"worktrees")` ✓), loop.pid `src/cli.ts:261` ✓, `observedFiles` `src/PendingSchema.ts:117` + partition `:281` ✓, `revertedTags` `src/Phase.ts:73` ✓. Axis-C defect still live as §3 describes (`src/cli.ts:250` exits `failed?1:0`; `superviseLoop` stop only via `baton.hibernating()` `src/Dispatcher.ts:1377`). Gaps = exactly §2c's list — derived above, no extra findings. `d2371fe` (spec) + `135a8d7` (release cut) are human commits, in-lane.

**OQ movement**: 4 closed by v0.4 — orphaned-baton (→ §3 entry), per-phase agent (→ §4 entry), entry-scoped guard (→ §5 entry), teardownWorktree/v0.1.2 surface (recorded by §2b; docs gap → `DOCS-PR5-SURFACE`). 1 new: §5 dogfood adoption (plan-prompt obligation text + chain.ts `entryChannelPaths`) — off-allowlist `chore(flume):`, sequenced after `ENTRY-SCOPED-GUARD`. §7a gate-move OQ unchanged (v0.4 doesn't touch it).

**Drain**: none (inbox empty). **Promote**: none.

## Queue (6)

Head: `AXIS-C-ORPHANED-AWAKE`. Then `ENTRY-SCOPED-GUARD`, `PHASE-AGENT`, `TEST-PR5-SURFACE`, `DOCS-PR5-SURFACE`, `CI-WINDOWS-LANE`. All open, no gates.

## Active plan target

`spec/RELEASE-v0.4.md` — fully decomposed this tick. Remaining underived surface: none (§§2c,3,4,5,6 all covered; §6 disciplines shipped in 0.3.1, lane entry is the enforcement; §7 folded into entries; §8/§9 are constraints, not deliverables).

## Open questions

**2 (both PARKED)**: §7a chain.ts gate-move (`chore(flume):`, precondition satisfied), v0.4-§5 dogfood adoption (`chore(flume):`, after `ENTRY-SCOPED-GUARD`).

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}`. inbox.md untouched (empty). All on-allowlist.
- Trunk: HEAD `d2371fe` at tick start. tsc green (harness block clean).

Plan continues: no
