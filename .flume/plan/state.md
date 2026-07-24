# State

Phase: **v0.6 line active** — `spec/RELEASE-v0.6.md` (`7c05fab`), queue derived (`dec90d2`). Lines v0.1–v0.5 frozen. Mode this tick: **audit**.

## This tick — audit 2 commits (HARVEST-DECL shipped)

Delta = 2 commits since `ea5c2e0`: `b55cc18` (build: chain-declared harvest for job extract) and `ad5443d` (chore(flume): ship HARVEST-DECL). No spec-delta, no inbox entries.

**Audit**:
- `b55cc18` — cross-checked against spec §5: `Chain.harvest?: string[]` added beside `seedDir` (src/Phase.ts); `jobExtract` loads the repo chain via `configDir` before any git mutation and defaults `harvestPaths` to `[]` when the field is absent (src/job.ts); `cli.ts` resolves `configDir` for the `extract` verb the same way `job new` already does (`FLUME_CONFIG_DIR` env override else `<repoRoot>/.flume` — intentional duplication, not drift: `job new`/`job extract` are the two verbs outside `resolveStateDirs`'s `--job`-aware resolution, by design). `HARVEST_PATHS` deleted from `src/job.ts`; confirmed zero remaining references anywhere in `src/`, `tests/`, `docs/`, `README.md`. Touched files exactly match HARVEST-DECL's declared `files` — no scope creep. Test coverage matches §6's §5 bullet exactly: declared list harvested verbatim (existing forks-off-`--onto` test extended), absent-on-branch paths → null entries (renamed/kept), and a new case for an undeclared chain field → empty harvest array, extract otherwise unchanged. Ran live: `tsc --noEmit` clean; `pnpm test` 196 passed, 4 skipped.
- **Finding, filed as `EXTRACT-CHAIN-USAGE`**: `b55cc18`'s commit message claims "a broken/missing chain fails usage-shaped" (i.e. `JobUsageError`, CLI exit 2), matching `jobNew`'s parity pattern. The code doesn't back this up — `jobExtract` calls `loadChainModule` directly with no `existsSync` guard (unlike `jobNew`'s explicit pre-check at `job.ts:190-196`), so a missing chain throws a plain `Error`. Confirmed empirically against a scratch repo (had to strip the ambient `FLUME_CONFIG_DIR`/`FLUME_DIR` this very flume session runs under — first pass silently pointed the scratch extract at this repo's own chain and gave a false pass): CLI exits **1**, not 2, though the job is correctly left untouched (branch + HEAD intact — the "no mutation before the load" ordering is sound). `jobExtract`'s own docstring (job.ts:549-552) is accurate to the code — it does not list chain-load among the `JobUsageError` cases — so the drift is between the commit message's claim and the implementation, not a doc/code mismatch. Filed as a pending fix + test, `per` §5, queue head (independent of `DOCS-0-6`/`CUT-0-6-0`).
- `ad5443d` — mechanical ship: retired HARVEST-DECL from pending.json, flipped `DOCS-0-6`'s gate from `blockedBy HARVEST-DECL` to `open`. Correctly left `CUT-0-6-0` alone (still `blockedBy DOCS-0-6`, which remains in the queue).

**Promote**: checked — no `blockedBy` tag in pending-now cites a now-absent entry (`CUT-0-6-0` cites `DOCS-0-6`, still present). Nothing to flip.

## Queue (3)

Head: **EXTRACT-CHAIN-USAGE** (open, new this tick) → **DOCS-0-6** (open) → **CUT-0-6-0** (blockedBy DOCS-0-6).

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (new EXTRACT-CHAIN-USAGE entry at head) and `.flume/plan/state.md` this tick; open-questions.md/inbox.md unchanged (already correct on disk).
- Trunk: HEAD `ad5443d` at tick start, tree clean besides plan artifacts and untracked runtime `.flume/loop.pid`. **main ahead of origin** — human push pending.

Plan continues: no
