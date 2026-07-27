# State

Phase: **v0.6.1 line complete** — `spec/RELEASE-v0.6.1.md`. All three entries
(§2 `NODE-BIN-ENTRY`, §3 `INSTALL-SMOKE-TEST`, §4 `CHANGELOG-0-6-1`) have
shipped. `pending.json` is `[]`. Mode this tick: **audit**.

## This tick — audit the CHANGELOG-0-6-1 ship

Delta since last `plan:` (`7b21464`): two commits, `b9e4039` (build: add
0.6.1 CHANGELOG section) and `4f27e6f` (chore(flume): ship CHANGELOG-0-6-1 —
pending.json drain, mechanical). No spec changes since `7b21464` (`git diff
7b21464..HEAD -- spec/` empty), inbox empty (header only), pending-now empty
— audit is the only live dimension; drain and promote are no-ops.

**Audit `b9e4039` against §4 (CHANGELOG):**
- `CHANGELOG.md` gains a `## [0.6.1]` section between `[Unreleased]` and
  `[0.6.0]` with a one-line pointer to `spec/RELEASE-v0.6.1.md`, then
  `### Fixed` (Windows bin was `#!/bin/sh`, shims hunted `sh.exe`, failed
  under PowerShell/cmd) and `### Added` (`smoke:install` pack-and-install
  test). Both bullets match §4's cited content; no restated mechanics beyond
  what §4 itself specifies.
- No version bump in `package.json` (still `0.6.0`) — correct, §4 is
  explicit that the bump + `npm publish` are human-performed at cut time.
- File scope matches the entry's declared `files` exactly (`CHANGELOG.md`
  edit only) — diff confirms no other file touched. No scope creep.
- `4f27e6f` (chore ship) — pending.json diff is exactly the removal of the
  now-shipped `CHANGELOG-0-6-1` entry, leaving `[]`. Mechanical, matches
  `<pending-now>` and the on-disk file byte-for-byte.
- No drift, no missed cases, no gate-bypass found. Clean ship — and with it,
  the v0.6.1 line itself is fully shipped (all three spec sections closed).

**Drain:** inbox empty (header only) — nothing to route.

**Promote:** `<pending-now>` is `[]` — no entries to check, nothing to
promote.

## Queue (0)

Empty. v0.6.1 line closed. No newer `spec/RELEASE-*.md` exists yet — the
next line (candidate: the parked engine-ownership requests below) needs a
human to author its spec before plan can derive entries from it.

## Open questions (1)

- Engine-ownership requests from centercode-platform's chain — still PARKED,
  unchanged this tick, needs human spec-scoping decision. This is now the
  only live thread; closing it (or declining it) is the plan-side blocker to
  originating a v0.7 line.

## Writable-paths / trunk

- Wrote only `.flume/plan/state.md` this tick — `pending.json`,
  `open-questions.md`, and `inbox.md` are unchanged from `<pending-now>`,
  `<open-questions>`, and `<inbox>` as given (audit found nothing requiring
  edits to them; verified on-disk pending.json byte-for-byte matches `[]`).
- Trunk: HEAD `4f27e6f` at tick start, tree clean besides untracked runtime
  `.flume/loop.pid`. main still ahead of origin — human push still pending.
  Human action outstanding: version bump + `npm publish` for 0.6.1 (out of
  phase scope per §4).

Plan continues: no
