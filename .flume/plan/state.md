# State

Phase: **v0.7 line in flight** — 1 entry in `pending.json`, `gate.kind:
"open"`. Mode this tick: **audit** (commit-delta since the last `plan:`
commit, `0590fa2`, is 2 commits; no spec-delta, empty inbox, nothing to
promote).

## This tick

**Commit-delta** (`0590fa2..HEAD`, 2 commits): `f55aa9a` (build,
`ENGINE-PIN-HANDSHAKE`, v0.7 §10), `387ef5b` (chore, ship — entry
removed from `pending.json`).

- `f55aa9a` cross-checked against §10 directly in source, not just the
  diff. `engineHandshake` (`src/cli.ts:150-175`) runs all three arms in
  order, ahead of `--job` extraction and every other line in `main()`
  (`src/cli.ts:709`), matching "before subcommand dispatch": arm 1
  (`readLocalInstall` resolves) re-execs via `spawnSync` with argv
  verbatim and inherited stdio, no version comparison; arm 2 (no local
  install, `readPin` resolves) refuses exit 2 naming the pin and
  `readPackageVersion()`; arm 3 (unpinned) returns `undefined`, `main()`
  proceeds unchanged. Non-goals honored: one hop only (single
  `spawnSync`, no re-entrant handshake in the re-exec'd process), no new
  OS-shim machinery (reuses the plain junction `job new` already
  provisions via `readFileSync`, not redesigned).
- Verified the commit's own claim that `bin/flume.js`/`bin/flume` needed
  no edit — read both; each is a thin spawn of `dist/cli.js` with no
  handshake logic of its own, so `main()` is the only entrypoint and
  hosting the handshake there is correct, not a missed site.
- Ran the new tests directly: `vitest run tests/cli.test.ts -t
  "engine"` — 3/3 pass (local-install re-exec regardless of global
  version; pinned-absent refusal naming pin + both versions + link
  path; unpinned no-op). Matches the acceptance line verbatim via
  real-CLI subprocess fixtures (`runCli`), not unit-level stubs — same
  rigor as `BAY-DISCOVERY-WALKUP`'s trio last tick. `tsc --noEmit`
  clean.
- `f55aa9a`'s diffstat touches `.flume/plan/open-questions.md` beyond
  the entry's declared `files` — checked against `.flume/chain.ts:261`
  (`entryChannelPaths: [".flume/plan/open-questions.md", "tests/**"]`):
  a sanctioned channel path per `collaboration.md`'s "write the open
  question instead of deciding silently," not scope creep. No other
  path outside declared `files` touched.
- The build tick's own self-flagged open question
  (`ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH`) verified accurate this
  tick, independently: `ensureFlumeLink` (`src/job.ts:133-150`) always
  links at `<jobDir>/node_modules/@dtmd/flume` where `jobDir` is
  `resolveStateDirs`'s job-scoped `flumeDir`
  (`<repoRoot>/.flume/jobs/<name>`, `src/job.ts:248`) — one level
  deeper than the bay-root path `readLocalInstall` checks
  (`<repoRoot>/.flume/node_modules/@dtmd/flume`). Arm 1 genuinely
  cannot fire against any real `job new`-provisioned bay today. Stays
  parked as-is — still a human call between the literal spec reading
  and the job-scoped reading; nothing this tick's research resolved
  unambiguously enough to act on directly.
- `387ef5b`'s ship (declared-files diff touched, correctly cleared from
  `pending.json`) — no drift. §10 is fully closed modulo the parked
  question: all three arms implemented and tested, acceptance line
  covered, non-goals respected.

**Spec-delta**: none (`git diff 0590fa2..HEAD -- spec/` empty).

**Drain**: `.flume/inbox.md` confirmed header-only on disk — nothing to
route.

**Promote**: no entry in `pending-now` carries `gate.kind: "blockedBy"`
— nothing to flip.

## Queue (1)

1. `SETUP-WORKTREE-HELPER` — open.

Next tick's real work is a **build** tick picking off the queue head.

## Open questions (5)

Unchanged from prior ticks (none closed or opened this pass):
- `ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH` — PARKED (re-verified this
  tick against current source, see above).
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks).

## Writable-paths / trunk

- `pending.json`: untouched this tick — verified against disk, already
  matches the 1-entry state left by `387ef5b`'s ship; no drift found
  warranting a change.
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: untouched — verified against disk, matches
  content already current; the job-dir-mismatch question re-verified
  accurate, not re-worded.
- `inbox.md`: untouched (already empty, header-only).
- Trunk: HEAD `387ef5b` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not
  a plan concern).

Plan continues: no
