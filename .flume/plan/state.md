# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 6 entries, two
`open` (`FRICTION-GITIGNORE-TESTS`, `TEARDOWN-HARDENING`), four
`blockedBy`-chained behind `TEARDOWN-HARDENING`. Mode this tick: **audit**
(commit-delta was the only live dimension; drain/derive/promote all
no-ops — see below).

## This tick

- `git log --grep='^plan:' -n 1` → `f9c7806` (prior plan tick). Two commits
  since: `fa0fad4` (build: fold declared friction dir into runtime ignore
  set, FRICTION-GITIGNORE) and `0bcb366` (chore(flume): ship
  FRICTION-GITIGNORE — mechanical pending.json removal + promoting
  `TEARDOWN-HARDENING` blockedBy→open, not plan-authored). **Audit**:
  triggered on `fa0fad4`.
- `git diff f9c7806..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` chain (`FRICTION-REVERT-NOTE` →
  `TEARDOWN-HARDENING`, `FRICTION-SURFACING` → `FRICTION-REVERT-NOTE`,
  `CHANGELOG-0-6-2` → `FRICTION-SURFACING`) all reference tags still
  present. `TEARDOWN-HARDENING` was already flipped to `open` by the
  `0bcb366` chore commit prior to this tick — verified consistent.
  **Promote**: not triggered by plan directly this tick.

**Audit of `fa0fad4`** (FRICTION-GITIGNORE): read the diff against §3 —
`ensureRuntimeIgnores(jobDir, extra)` merges `RUNTIME_IGNORES ∪ extra` with
the same idempotent create-or-append logic (`src/job.ts:102-116`);
`frictionIgnoreEntry` normalizes a declared friction dir to
forward-slashed, single-trailing-slash (`src/job.ts:124-126`); `jobNew`
passes `chain.friction` through as one `extra` entry when declared,
`[]` otherwise (`src/job.ts:~242`). Matches §3's mechanics and the
"idempotent, template-authored lines preserved verbatim" contract — no
drift. Checked §3's "wherever the engine today ensures the runtime ignore
entries... and any other site" language against the actual call graph:
`ensureRuntimeIgnores`/`.gitignore` writes have exactly one call site
(`jobNew`) — no second site silently missed.

**Real gap found**: `fa0fad4` touches only `src/job.ts` —
`git show fa0fad4 --stat` shows no test file, and `tests/job.test.ts` has
zero coverage of the new `extra` param or the friction pass-through (its
only "friction" hits are the pre-existing, unrelated harvest-based
`friction.md` tests). This is the identical defect shape audited and
named last tick in `FRICTION-DECLARATION-TESTS`'s own notes
(d009f19/`231440e`): the `FRICTION-GITIGNORE` entry (drafted at the
original `443aa1a` derive, before that pattern was diagnosed) named
`tests/job.test.ts` under `tests[]` but never under `files.edit`, so the
entry-scoped write guard excluded it and the commit shipped with zero
committed coverage instead of manual-only. The fix applied to
`FRICTION-DECLARATION-TESTS` at the time didn't get retroactively applied
to `FRICTION-GITIGNORE`, which was still queued (`blockedBy`) and out of
that tick's audit scope — filed now as a follow-up,
`FRICTION-GITIGNORE-TESTS` (open, head of queue), `tests/job.test.ts`
explicit under `files.edit` this time.

`0bcb366` (the chore commit) is a mechanical pending.json diff (entry
removal + one gate promotion, no source changes) — internally consistent,
nothing further to audit.

## Queue (6)

`FRICTION-GITIGNORE-TESTS` (open, next) → `TEARDOWN-HARDENING` (open) →
`FRICTION-REVERT-NOTE` → `FRICTION-SURFACING` → `CHANGELOG-0-6-2`. Two
entries are build-ready; the rest are chained behind `TEARDOWN-HARDENING`
in shipping order.

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (filed `FRICTION-GITIGNORE-TESTS`) and
  `.flume/plan/state.md` this tick. No spec change to derive, no inbox to
  drain, no further promotion needed. `open-questions.md` and `inbox.md`
  are untouched (identical to `HEAD`).
- Trunk: HEAD `0bcb366` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
