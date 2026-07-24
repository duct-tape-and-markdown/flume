# State

Phase: **v0.6 line active** — `spec/RELEASE-v0.6.md` (`7c05fab`), queue derived (`dec90d2`). Lines v0.1–v0.5 frozen. Mode this tick: **audit**.

## This tick — audit 2 commits (RESIDENCY-RESOLUTION shipped)

Delta = 2 commits since `dec90d2`: `c3b3379` (build: narrow job resolution to flumeDir) and `1957ec7` (chore(flume): ship RESIDENCY-RESOLUTION). No spec-delta, no inbox entries, pending already reflects the post-ship state.

**Audit**: both clean.
- `c3b3379` — cross-checked against spec §2/§3: `resolveStateDirs` (src/cli.ts:94-120) retargets only `flumeDir`; conflict check narrowed to `FLUME_DIR`; `configDir` composes with `FLUME_CONFIG_DIR`. Docstrings (cli.ts:60-97, job.ts:231-237) and help text (cli.ts:168-174) match. Touched files exactly match RESIDENCY-RESOLUTION's declared `files` (src/cli.ts, src/job.ts, tests/cli.test.ts, tests/job.test.ts, tests/job.integration.test.ts) — no scope creep. Test coverage verified live: `tsc --noEmit` clean; `pnpm test` (cli.test.ts, job.test.ts) 56 passed; `pnpm test:integration` (job.integration.test.ts) 6 passed — including the inert-trap-chain fixture and the composed-`FLUME_CONFIG_DIR` end-to-end case §6 calls for. Acceptance ("pnpm test green, tsc green") genuinely met before ship.
- `1957ec7` — mechanical ship: retired RESIDENCY-RESOLUTION from pending, flipped SEED-DIR + HARVEST-DECL from `blockedBy` to `open`. Verified correct (only pending.json touched; the two dependents' gates are the only ones that cited the shipped tag).

Noted but out of scope for this tick's audit: `c4032cd` (chore(flume): tick agents on Sonnet, `.flume/chain.ts`) landed after this tick's computed commit-delta boundary — a human/harness model-pin, not spec-derived work; nothing to route.

**Derive / Drain / Promote**: no triggers (spec unchanged, inbox empty, no further blockedBy tags reference a now-absent entry). No pending.json changes this tick.

## Queue (4)

Head: **SEED-DIR** (open) and **HARVEST-DECL** (open, independent of seed) → **DOCS-0-6** (blockedBy HARVEST-DECL) → **CUT-0-6-0** (blockedBy DOCS-0-6).

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only this tick; pending.json/open-questions.md/inbox.md unchanged (already correct on disk).
- Trunk: HEAD `c4032cd` at tick start, tree clean besides plan artifacts and untracked runtime `.flume/loop.pid`. **main ahead of origin** — human push pending.

Plan continues: no
