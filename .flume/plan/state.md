# State

Phase: **v0.6.1 line active** — `spec/RELEASE-v0.6.1.md` (`0e9412f`). One of
three entries remains queued (`CHANGELOG-0-6-1`, now unblocked); §2
(`NODE-BIN-ENTRY`) and §3 (`INSTALL-SMOKE-TEST`) have both shipped. Mode this
tick: **audit**.

## This tick — audit the INSTALL-SMOKE-TEST ship

Delta since last `plan:` (`0ccbc9c`): two commits, `7c035b8` (build: install
smoke test) and `c337685` (chore(flume): ship INSTALL-SMOKE-TEST — pending.json
removal + gate flip, mechanical). No spec changes since `0ccbc9c` (`git diff
0ccbc9c..HEAD -- spec/` empty), inbox empty — audit is the only live
dimension.

**Audit `7c035b8` against §3 (Install smoke test):**
- `scripts/smoke-install.mjs` — plain Node, no deps beyond `node:*` builtins;
  `npm pack` to a `mkdtemp` scratch dir → `npm init -y` + `npm i <tarball>` →
  runs the *generated* shim (`flume.cmd` on win32) `--version` → scaffolds
  `.flume/chain.ts` importing `shellGate` from `@dtmd/flume` + a one-line
  prompt stub → runs the shim's `render notes`. First failing step aborts
  non-zero, named. Matches §3 step-for-step.
- `package.json` — `scripts.smoke:install` → `node scripts/smoke-install.mjs`,
  matches §3 verbatim. Correctly excluded from the `files` allowlist
  (dev-only script, not shipped in the tarball).
- `.github/workflows/ci.yml` — wired into the existing `windows-latest` lane
  (no new lane needed, none was added) with a `pnpm build` step ahead of it
  (`npm pack` needs `dist/`). Minimal wiring per §3.
- File scope matches the entry's declared `files` exactly (script new,
  `package.json` + `ci.yml` edit) — no scope creep.
- Verified rather than assumed: ran `pnpm run smoke:install` live on this
  win32 machine — packed, installed, `flume.cmd --version` → `0.6.0`,
  scaffolded fixture, `flume.cmd render notes` printed the harness block and
  exited 0. Matches §3's acceptance line exactly. `pnpm tsc --noEmit` clean.
- `c337685` (chore ship) — pending.json diff is exactly: drop
  `INSTALL-SMOKE-TEST`, flip `CHANGELOG-0-6-1` from `blockedBy` to `open`.
  Correct and mechanical; matches `<pending-now>` and the on-disk file,
  nothing to redo.
- No drift, no missed cases, no gate-bypass found. Clean ship.

**Drain:** inbox empty (header only) — nothing to route.

**Promote:** `CHANGELOG-0-6-1`'s `blockedBy` was already flipped to `open` by
the `c337685` chore commit — the only pending entry, no others to check.
Nothing left to promote this tick.

## Queue (1)

1. `CHANGELOG-0-6-1` — open, next to build. Last entry on the v0.6.1 line.

## Open questions (1)

- Engine-ownership requests from centercode-platform's chain — still PARKED,
  unchanged this tick, needs human spec-scoping decision.

## Writable-paths / trunk

- Wrote only `.flume/plan/state.md` this tick — `pending.json`,
  `open-questions.md`, and `inbox.md` are unchanged from `<pending-now>`,
  `<open-questions>`, and `<inbox>` as given (audit found nothing requiring
  edits to them; verified on-disk pending.json byte-for-byte matches
  `<pending-now>`).
- Trunk: HEAD `c337685` at tick start, tree clean besides untracked runtime
  `.flume/loop.pid`. main still ahead of origin — human push still pending.

Plan continues: no
