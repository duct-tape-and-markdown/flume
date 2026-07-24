# State

Phase: **v0.6 line active** — `spec/RELEASE-v0.6.md` (`7c05fab`), queue derived (`dec90d2`). Lines v0.1–v0.5 frozen. Mode this tick: **audit**.

## This tick — audit 3 commits (EXTRACT-CHAIN-USAGE + DOCS-0-6 shipped)

Delta = 3 commits since `10074fa`: `a10c011` (build: jobExtract JobUsageError on missing chain), `3b80021` (build: docs for chain residency + seed/harvest), `685f6b0` (chore(flume): ship both). No spec-delta, no inbox entries.

**Audit**:
- `a10c011` (EXTRACT-CHAIN-USAGE) — closes exactly the gap filed last tick: added `existsSync(chainPath)` guard in `jobExtract` before `loadChainModule`, throwing `JobUsageError` (mirrors `jobNew`'s pattern at job.ts:190-196), placed before any mutation. Docstring's `JobUsageError` enumeration updated to include the missing-chain case. New test (`tests/job.test.ts`) asserts `JobUsageError`, message match, and that HEAD/branch/job are untouched. Scope matches the filed entry's `files` exactly — no creep.
- `3b80021` (DOCS-0-6) — cross-checked README, `docs/CLI.md`, `docs/CHAIN-AUTHORING.md` against spec §2–§5, §7. Chain-residency contract, `--template` removal, `Chain.seedDir`/`Chain.harvest` declaration surface, and the shim-migration note are all present and accurate to current `src/` behavior. Verified zero remaining `--template` references outside the deletion-note prose. `docs/CHAIN-AUTHORING.md`'s new "(see \"Where the chain lives\" above)" cross-reference resolves to the real `## Where the chain lives` heading (line 10) — not a dangling link. No separate getting-started file exists (§7's "CHAIN-AUTHORING / getting-started" maps to README's quick-start, as noted when this entry was filed) — accepted, not a gap.
- `685f6b0` — mechanical ship: retired both entries from pending.json, flipped `CUT-0-6-0`'s gate from `blockedBy DOCS-0-6` to `open` in the same commit (pre-empting this tick's promote check).
- Ran live: `pnpm tsc --noEmit` clean; `pnpm test` 197 passed, 4 skipped.
- No drift found in either commit. No new findings this tick.

**Promote**: `CUT-0-6-0` already flipped `blockedBy → open` by `685f6b0` itself — nothing left to do.

**Drain**: inbox empty, nothing to route.

## Queue (1)

Head: **CUT-0-6-0** (open) — last entry on the v0.6 line.

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only this tick — pending.json, open-questions.md, inbox.md already correct on disk (audit found no drift, nothing to drain).
- Trunk: HEAD `685f6b0` at tick start, tree clean besides untracked runtime `.flume/loop.pid`. **main ahead of origin** — human push pending.

Plan continues: no
