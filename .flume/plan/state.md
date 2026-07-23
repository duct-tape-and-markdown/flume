# State

Phase: **v0.6 line active** — `spec/RELEASE-v0.6.md` authored (`7c05fab`); queue derived in full this tick. Lines v0.1–v0.5 frozen. Mode this tick: **derive**.

## This tick — derive v0.6, drain the dogfood inbox entry, audit 3 commits

Delta = 3 commits (`7c05fab` spec, `0592e90` inbox filing, `cf6995e` chore alias); spec delta = new `spec/RELEASE-v0.6.md`; inbox 1 entry; pending was empty.

**Derive**: v0.6 decomposed into 5 entries — RESIDENCY-RESOLUTION (§3, open) → SEED-DIR (§4) + HARVEST-DECL (§5, both blockedBy residency) → DOCS-0-6 (§7, blockedBy harvest; also rests on seed via queue order) → CUT-0-6-0 (§10, blockedBy docs). §6 tests folded into each feature entry's `tests`. File declarations verified against source: `resolveStateDirs` src/cli.ts:94-119, `jobNew` template path src/job.ts:165-193, `HARVEST_PATHS` src/job.ts:463, `Chain` src/Phase.ts:205; `--template` referenced by tests/job.test.ts + tests/job.integration.test.ts only (cli.test.ts clean); HARVEST_PATHS not re-exported from index.ts. This repo's `.flume/chain.ts` needs no companion edit — both new `Chain` fields are optional and this repo uses no job resolution.

**Drain**: the 2026-07-23 static-.flume dogfood entry routes entirely to pending — asks 1+3 → RESIDENCY-RESOLUTION (spec §2/§3 adopted the filer's "one decision" framing), ask 2 → SEED-DIR (§4). Nothing parked; inbox empty.

**Audit**: all 3 commits clean. `7c05fab` — human-authored spec, spec lane; source cites spot-checked (cli.ts:117 write-back, job.ts:463, resolveStateDirs lines) and accurate. `0592e90` — external filing to inbox.md, the designated lane. `cf6995e` — human interactive package.json alias; checked docs for `pnpm exec flume` drift: README/docs don't reference either invocation form, no follow-up needed (CLAUDE.md's mention is the human's surface).

**Promote**: none (pending was empty).

## Queue (5)

Head: **RESIDENCY-RESOLUTION** (open). Then SEED-DIR, HARVEST-DECL (unblock when residency ships), DOCS-0-6, CUT-0-6-0. Linear line to the 0.6.0 cut.

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json`, `.flume/plan/state.md`, `.flume/inbox.md` (drained); open-questions.md untouched (empty).
- Trunk: HEAD `7c05fab` at tick start, tree clean besides plan artifacts (untracked `.flume/loop.pid` is runtime). **main ahead 2 of origin/main** (3 with this commit) — human push pending.

Plan continues: no
