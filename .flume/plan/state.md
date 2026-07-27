# State

Phase: **v0.6.1 line active** — `spec/RELEASE-v0.6.1.md` (`0e9412f`). Two of
three entries remain queued (`INSTALL-SMOKE-TEST`, `CHANGELOG-0-6-1`); §2
(`NODE-BIN-ENTRY`) has shipped. Mode this tick: **audit**.

## This tick — audit the NODE-BIN-ENTRY ship

Delta since last `plan:` (`8c6b11b`): two commits, `7bdf09c` (build: Node bin
entry) and `1293a23` (chore(flume): ship NODE-BIN-ENTRY — pending.json
removal + gate flip, mechanical). No spec changes since `8c6b11b`, inbox
empty — audit is the only live dimension.

**Audit `7bdf09c` against §2 (Node bin entry):**
- `bin/flume.js` — `#!/usr/bin/env node`, spawns `dist/cli.js` via
  `spawnSync` with inherited stdio and `process.argv.slice(2)`, propagates
  exit code and re-raises signals. Matches §2's argv/stdio/exit-propagation
  requirement; no option parsing or output of its own added.
- `package.json` — `bin.flume` and `scripts.flume` both repointed to
  `./bin/flume.js`; `bin/flume` (POSIX) untouched and still present, matching
  §2's "stays for direct callers, no longer what bin.flume points at."
- File scope matches the entry's declared `files` exactly (`bin/flume.js`
  new, `package.json` edit) — no scope creep.
- Verified rather than assumed: `npm pack --dry-run` lists both `bin/flume`
  and `bin/flume.js` in the tarball (package.json's `files: ["bin", ...]`
  already covers it — no `files` edit was needed and none was made).
  `pnpm tsc --noEmit` clean.
- `1293a23` (chore ship) — pending.json diff is exactly: drop `NODE-BIN-ENTRY`,
  flip `INSTALL-SMOKE-TEST` from `blockedBy` to `open`. Correct and
  mechanical; matches `<pending-now>`, nothing to redo.
- No drift, no missed cases, no gate-bypass found. Clean ship.

**Accepted debt (not filed, not blocking):** `pnpm test` shows one failure —
`tests/cli.test.ts` "reclaims a stale pidfile (dead pid): the loop runs and
drops the lock on exit" (expected exit 0, got 1). Re-ran the test in
isolation (`vitest run tests/cli.test.ts -t "reclaims a stale pidfile"`) and
it passed clean — a full-suite timing flake in the loop-lock reclaim path
(process-spawn contention on Windows), not a regression from `7bdf09c` (the
failing test exercises pidfile locking, an unrelated code path from bin
resolution). Not filed as a pending entry: no citable spec section, and v0.4
§5's stale-pidfile-reclaim behavior itself is unchanged. Flagging here in
case it recurs across ticks — if it does, that's a signal for a human to
scope a flake-hardening entry.

**Drain:** inbox empty (header only) — nothing to route.

**Promote:** `INSTALL-SMOKE-TEST`'s `blockedBy` was already flipped to `open`
by the `1293a23` chore commit; `CHANGELOG-0-6-1` correctly still `blockedBy
INSTALL-SMOKE-TEST` (not yet shipped). Nothing left to promote this tick.

## Queue (2)

1. `INSTALL-SMOKE-TEST` — open, next to build.
2. `CHANGELOG-0-6-1` — blockedBy INSTALL-SMOKE-TEST.

## Open questions (1)

- Engine-ownership requests from centercode-platform's chain — still PARKED,
  unchanged this tick, needs human spec-scoping decision.

## Writable-paths / trunk

- Wrote only `.flume/plan/state.md` this tick — `pending.json`,
  `open-questions.md`, and `inbox.md` are unchanged from `<pending-now>`,
  `<open-questions>`, and `<inbox>` as given (audit found nothing requiring
  edits to them).
- Trunk: HEAD `1293a23` at tick start, tree clean besides untracked runtime
  `.flume/loop.pid`. main still ahead of origin — human push still pending.

Plan continues: no
