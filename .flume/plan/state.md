# State

Phase: **v0.6.2 line derived** — `spec/RELEASE-v0.6.2.md` (friction lifecycle
+ win32 teardown fallback). `pending.json` holds 6 entries, linearly
`blockedBy`-chained. Mode this tick: **derive** (heaviest dimension: a new
spec file, §§2-8; drain and audit both live but smaller).

## This tick

Delta since last `plan:` (`78d423b`): 5 commits — 4 inbox additions (win32
worktree cleanup, entry-scope-revert + operator addendum, CLI junction
silent-exit) and 1 spec addition (`fed25d1`, `spec/RELEASE-v0.6.2.md`, new
file — no prior version to diff against, so treated as full-file derive
per §§2-8; §1 is purpose/scope, not a deliverable). A 4th inbox entry
(harness-block fence mismatch) landed mid-tick, after commit-delta was
computed — handled below alongside the rest; drain covers what's on disk
at commit time, not just what commit-delta captured.

**Derive (`spec/RELEASE-v0.6.2.md` §§2-8) → 6 entries, linear `blockedBy`
chain** (the schema's `blockedBy` takes one tag, so a fan-out-then-converge
shape risked `CHANGELOG-0-6-2` promoting before a sibling shipped — chained
instead; cross-file overlap on `src/Dispatcher.ts` across 3 of the 6 makes
this the real execution order anyway, not just a paperwork constraint):

1. `FRICTION-DECLARATION` (§2) — `Chain.friction` field + load-time
   validation. Foundational, `open`.
2. `FRICTION-GITIGNORE` (§3) — declared dir → runtime `.gitignore` set.
3. `TEARDOWN-HARDENING` (§4 + §7, bundled) — pre-removal friction harvest
   and the win32 `worktree remove` fallback, in the same wave-end loop.
   Bundling follows the operator's own framing (`a326c1c`): same code
   path, one visit. This is the entry that actually closes both the
   win32-cleanup and friction-eaten-by-teardown field reports.
4. `FRICTION-REVERT-NOTE` (§5) — afterCommit gate-revert verdict written to
   the friction channel.
5. `FRICTION-SURFACING` (§6) — status/job-status/loop friction counts;
   `job extract` reads the declared dir off the working tree (friction is
   gitignored — `git show`-based harvest can never see it) instead of the
   legacy hardcoded `friction.md` guess.
6. `CHANGELOG-0-6-2` (§8) — last, `blockedBy FRICTION-SURFACING`.

All `files` verified against build's `writablePaths` (`src/**`, `tests/**`,
`CHANGELOG.md` all covered). No new files — every entry edits existing
modules (`Phase.ts`, `Dispatcher.ts`, `git.ts`, `job.ts`, `cli.ts`,
`CHANGELOG.md`) plus their existing test files.

**Drain (inbox, 4 entries → 0):**
- Win32 worktree cleanup → filed into `TEARDOWN-HARDENING` above (§7 cite).
- Entry-scope-revert finding + operator addendum → split by the spec's own
  disposition: the teardown/friction-harvest half ships (`TEARDOWN-HARDENING`
  §4, `FRICTION-REVERT-NOTE` §5); the *plan*-addressed half (persist the
  revert verdict where plan reads it) is explicitly declined by
  `spec/RELEASE-v0.6.2.md` §5 ("awaits the v0.7 scoping call") — folded as
  item 5 into the existing "Engine-ownership requests" open question rather
  than opening a new one, since it shares that question's blocker (no
  citable spec section, touches pending.json's own schema) and disposition.
- CLI-through-a-junction silent-exit → **no citable spec/rule section**
  (root cause and fix are both diagnosed — see open-questions.md — but
  nothing in `spec/` or `.claude/rules/` governs CLI-entry invocation
  correctness, and `spec/RELEASE-v0.6.1.md` §2 is shipped/frozen, not
  reopened here). Parked as a new open question with a direct
  recommendation, per the "inform before parking" research already done.
- Harness-block fence mismatch (landed mid-tick) → **not a clean bug fix**:
  `docs/CHAIN-AUTHORING.md` §5's own worked example documents today's
  (misleading) collapsed rendering as correct, and `spec/RELEASE-v0.4.md`
  §5 mandates only the *retry* feedback name the offending path, not the
  *pre-commit* block state the narrowed fence — closing this changes
  documented behavior, a spec-shaped call. Parked with the finding's own
  proposed fix shape attached.
All four entries removed from `inbox.md`; header preserved.

**Audit:** no commits touch `src/`, `tests/`, or any previously-shipped
`per.section` this tick — the new commits are 1 spec + inbox writes, both
human-authored artifacts outside audit's remit (audit checks build's
diffs against spec, not humans' spec/inbox writes). Nothing to audit.

**Promote:** `<pending-now>` was `[]` at tick start — nothing to promote.

## Queue (6)

`FRICTION-DECLARATION` → `FRICTION-GITIGNORE` → `TEARDOWN-HARDENING` →
`FRICTION-REVERT-NOTE` → `FRICTION-SURFACING` → `CHANGELOG-0-6-2`, in that
order (see above). All open or blockedBy a sibling in this same chain —
build can start on `FRICTION-DECLARATION` immediately.

## Open questions (3)

- Engine-ownership requests from centercode-platform's chain — PARKED,
  updated this tick with a 5th item (persist revert verdict for plan) that
  `spec/RELEASE-v0.6.2.md` §5 explicitly deferred to the same v0.7 scoping
  call. Still the top blocker to originating a v0.7 line.
- CLI entry silently no-ops through a directory junction — new this tick,
  PARKED. Diagnosed and a fix recommended; blocked only on a human choosing
  how to authorize it (fold into a patch spec vs. approve inline as
  spec-exempt).
- Harness block states the unnarrowed fence on entry-scoped ticks — new
  this tick, PARKED. Diagnosed, fix shape proposed by the finding itself,
  but closing it means rewriting documented behavior
  (`docs/CHAIN-AUTHORING.md` §5), a call for a human, not plan.

**Pattern worth naming, not acted on:** two of this tick's three open
questions (CLI silent-exit-0, harness-block fence) plus engine-ownership
request #4 (chain-load failure still exits 0) are all instances of "the
engine tells the agent or operator something false rather than surfacing
the truth." Same law across all three; might argue for scoping them
together whenever the v0.7 line gets authored, rather than as unrelated
one-offs.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (6 entries), `.flume/plan/state.md`
  (this file), `.flume/plan/open-questions.md` (2 updates + 1 new
  question), `.flume/inbox.md` (drained to header-only) — all within this
  phase's writable paths. Did not touch `spec/` or `src/`.
- Trunk: HEAD `fed25d1` at tick start, tree clean besides untracked runtime
  `.flume/loop.pid` (unwritable path, left alone). main still ahead of
  origin — human push still pending (carried over; not re-verified this
  tick, out of plan's remit).

Plan continues: no
