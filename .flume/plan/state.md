# State

Phase: **v0.6 line active** — `spec/RELEASE-v0.6.md` (`7c05fab`), queue derived (`dec90d2`). Lines v0.1–v0.5 frozen. Mode this tick: **audit**.

## This tick — audit 2 commits (SEED-DIR shipped)

Delta = 2 commits since `6a6ec10`: `3e254a1` (build: replace job new --template with chain-declared seedDir) and `5d66fad` (chore(flume): ship SEED-DIR). No spec-delta, no inbox entries.

**Audit**: both clean.
- `3e254a1` — cross-checked against spec §4: `Chain.seedDir?: string` added beside `humanOnly` (src/Phase.ts); `jobNew` (src/job.ts) now takes `configDir`, loads the repo chain post-checkout (`JobUsageError`/exit 2 if absent — "a job that could never `run` must not be creatable"), validates a declared `seedDir` exists before touching the state root (exit 2 if not), then `cp`s it verbatim with `force: false` (skip-existing); absent `seedDir` → bare job, no warning. `--template` fully deleted from `JobNewOptions`, `cli.ts` flag parsing, and help/usage text (`src/cli.ts`). Touched files exactly match SEED-DIR's declared `files` (src/Phase.ts, src/job.ts, src/cli.ts, tests/job.test.ts, tests/job.integration.test.ts) — no scope creep; `HARVEST_PATHS` correctly untouched (HARVEST-DECL's job). Test coverage verified live against the §6 list: seed+baseline, re-run preserves worked file + fills new stub (skip-existing), re-run with unchanged seed commits nothing, absent seedDir bare/no-warning, missing chain exit 2, declared-but-absent seedDir exit 2, `--template` rejected as unknown flag. Ran live: `tsc --noEmit` clean; `pnpm test` 195 passed; `pnpm test:integration` 9 passed. Acceptance genuinely met before ship.
- `5d66fad` — mechanical ship: retired SEED-DIR from pending.json, no other lines touched. Correctly did **not** flip HARVEST-DECL's gate — HARVEST-DECL was already `open` (independent of SEED-DIR, confirmed by diffing pending.json across the ship), so there was nothing to promote.

Found one stale note during audit: DOCS-0-6's `notes` field still referenced "Also rests on SEED-DIR" from before SEED-DIR shipped. Fixed in place this tick (re-derivation, not a hand-edit of authored content) — trimmed to the still-true getting-started pointer.

**Derive / Drain / Promote**: no triggers (spec unchanged, inbox empty; no `blockedBy` tag in pending-now cites a now-absent entry — DOCS-0-6 still correctly cites HARVEST-DECL, which remains in the queue).

## Queue (3)

Head: **HARVEST-DECL** (open) → **DOCS-0-6** (blockedBy HARVEST-DECL) → **CUT-0-6-0** (blockedBy DOCS-0-6).

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (one stale-note fix on DOCS-0-6) and `.flume/plan/state.md` this tick; open-questions.md/inbox.md unchanged (already correct on disk).
- Trunk: HEAD `5d66fad` at tick start, tree clean besides plan artifacts and untracked runtime `.flume/loop.pid`. **main ahead of origin** — human push pending.

Plan continues: no
