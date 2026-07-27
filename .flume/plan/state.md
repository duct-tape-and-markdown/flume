# State

Phase: **v0.6.1 line active** — `spec/RELEASE-v0.6.1.md` (`0e9412f`) is the
newest spec file: Windows install surface patch (Node bin entry, install
smoke test, CHANGELOG). Mode this tick: **derive**.

## This tick — derive v0.6.1, drain inbox

Delta = 3 commits since last `plan:` (`d837e4d`): `a9fe6b2` + `4ca55ef`
(inbox: four centercode-platform engine requests), `0e9412f` (spec:
v0.6.1 line). No commit-delta requiring audit — these are human spec/inbox
commits, not build commits with a `per` cite to cross-check for drift.

**Derive** (`spec/RELEASE-v0.6.1.md`, all 4 sections read in full):
- §1 Purpose & scope — framing only, no entry.
- §2 Node bin entry → `NODE-BIN-ENTRY` (open). New `bin/flume.js`, edit
  `package.json` bin/scripts. `bin/flume` (POSIX) stays, not retired.
- §3 Install smoke test → `INSTALL-SMOKE-TEST` (blockedBy NODE-BIN-ENTRY —
  its acceptance exercises the win32 shim NODE-BIN-ENTRY fixes, so it must
  ship second). New `scripts/smoke-install.mjs`, edit `package.json`
  (script alias) + `.github/workflows/ci.yml` (existing windows-latest lane
  gets the smoke step — no new lane needed).
- §4 CHANGELOG → `CHANGELOG-0-6-1` (blockedBy INSTALL-SMOKE-TEST,
  transitively covers NODE-BIN-ENTRY too). Edit `CHANGELOG.md` only.
- Verified all three entries' paths (`bin/**`, `scripts/**`, `package.json`,
  `.github/**`, `CHANGELOG.md`) sit inside build's writablePaths
  (`.flume/chain.ts` lines ~189-249) — no open-question needed for fencing.
- Checked `tests/cli.test.ts` — it spawns the tsx CLI directly, not
  `bin/flume`; no existing vitest coverage touches the bin shim, so no test
  entries filed. Acceptance for both bin entries rides the smoke script
  itself (repeatable, not a one-off manual check) per spec intent.

**Drain** (inbox, 1 cluster / 4 items — all four centercode-platform engine
requests): none have a citable `spec/RELEASE-*.md` section (all are `src/`
engine-architecture asks with no spec yet), so none became pending entries.
Routed to `.flume/plan/open-questions.md` as one PARKED cluster, recommending
a human scope an engine-hardening spec line (v0.7?) — flagged item 3
(`GateContext.repoRoot`) as lowest-risk/first-candidate if the line gets
trimmed, and flagged items 2 and 4 as touching dispatcher/loop semantics
non-trivially (real design calls, not just "add a helper"). Inbox drained to
just the header — queue is empty.

**Promote**: `pending-now` was empty at tick start — nothing to unblock.

## Queue (3)

1. `NODE-BIN-ENTRY` — open, next to build.
2. `INSTALL-SMOKE-TEST` — blockedBy NODE-BIN-ENTRY.
3. `CHANGELOG-0-6-1` — blockedBy INSTALL-SMOKE-TEST.

## Open questions (1)

- Engine-ownership requests from centercode-platform's chain — PARKED,
  needs human spec-scoping decision before any of the four can become
  pending entries.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (3 entries), `.flume/plan/state.md`
  (this file), `.flume/plan/open-questions.md` (+1 parked cluster),
  `.flume/inbox.md` (drained to header). All four are plan's declared
  writable paths.
- Trunk: HEAD `0e9412f` at tick start, tree clean besides untracked runtime
  `.flume/loop.pid`. main still ahead of origin — human push still pending.

Plan continues: no
