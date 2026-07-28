# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 4 entries:
`TEARDOWN-HARDENING` (open, next), then `FRICTION-REVERT-NOTE` →
`FRICTION-SURFACING` → `CHANGELOG-0-6-2` chained behind it in shipping
order. Mode this tick: **audit** (commit-delta was the only live
dimension; it came back clean — no findings, nothing filed).

## This tick

- `git log --grep='^plan:' -n 1` → `444e8e2` (prior plan tick). Two
  commits since: `72c5272` (build: cover ensureRuntimeIgnores' friction
  pass-through, FRICTION-GITIGNORE-TESTS) and `50e75cc` (chore(flume):
  ship FRICTION-GITIGNORE-TESTS — mechanical pending.json entry removal,
  not plan-authored). **Audit**: triggered on `72c5272`.
- `git diff 444e8e2..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` chain (`FRICTION-REVERT-NOTE` →
  `TEARDOWN-HARDENING`, `FRICTION-SURFACING` → `FRICTION-REVERT-NOTE`,
  `CHANGELOG-0-6-2` → `FRICTION-SURFACING`) all reference tags still
  present in `pending-now`. `TEARDOWN-HARDENING` is already `open`.
  **Promote**: not triggered.

**Audit of `72c5272`** (FRICTION-GITIGNORE-TESTS, closing last tick's own
filed gap): read the diff against §3 and the entry's own `tests[].asserts`.
Coverage is 7 new tests — 3 unit-level on `ensureRuntimeIgnores`'s `extra`
param (fold, idempotent, no-dup-against-template) and 4 CLI-level on
`jobNew`'s `Chain.friction` pass-through (forward-slash+trailing-slash
normalization, idempotent re-run commits nothing, seedDir template lines
survive verbatim alongside the friction line, undeclared leaves
`.gitignore` at exactly `RUNTIME_IGNORES`). Matches §3's "idempotent,
template-authored lines preserved verbatim" contract with no drift. Diff
scope: only `tests/job.test.ts` touched, matching the entry's sole
declared `files.edit` path exactly — no scope creep. Re-checked §3's
"any other site that maintains the runtime ignore set" language against
the call graph: `ensureRuntimeIgnores` still has exactly one call site
(`jobNew`) — no second site went uncovered. Ran
`pnpm vitest run tests/job.test.ts` independently: 47/47 pass, including
all 4 new §3 CLI-level tests. No gap found — the follow-up entry filed
last tick closed cleanly, no further follow-up needed.

`50e75cc` (the chore commit) is a mechanical pending.json diff (one entry
removed, no source changes) — internally consistent with the shipped
work, nothing further to audit.

## Queue (4)

`TEARDOWN-HARDENING` (open, next) → `FRICTION-REVERT-NOTE` →
`FRICTION-SURFACING` → `CHANGELOG-0-6-2`, chained behind it in shipping
order. One entry is build-ready.

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` this tick only. `pending.json` audited and
  found to already match its target shape — no diff needed. No spec
  change to derive, no inbox to drain, no promotion needed.
  `open-questions.md` and `inbox.md` are untouched (identical to `HEAD`).
- Trunk: HEAD `50e75cc` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
