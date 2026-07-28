# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 5 entries, one
`open` (`FRICTION-GITIGNORE`), four `blockedBy`-chained behind it. Mode
this tick: **audit** (commit-delta was the only live dimension;
drain/derive/promote all no-ops — see below).

## This tick

- `git log --grep='^plan:' -n 1` → `1f94691` (the prior plan tick). Two
  commits since: `f278ad2` (build: cover Chain.friction load-time
  validation, FRICTION-DECLARATION-TESTS) and `5a5dee5` (chore(flume):
  ship FRICTION-DECLARATION-TESTS — mechanical pending.json removal, not
  plan-authored). **Audit**: triggered on `f278ad2`.
- `git diff 1f94691..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` tags (`TEARDOWN-HARDENING` →
  `FRICTION-GITIGNORE`, `FRICTION-REVERT-NOTE` → `TEARDOWN-HARDENING`,
  `FRICTION-SURFACING` → `FRICTION-REVERT-NOTE`, `CHANGELOG-0-6-2` →
  `FRICTION-SURFACING`) all reference tags still present in the array —
  none unblocked. `FRICTION-GITIGNORE` is already `open`. **Promote**: not
  triggered.

**Audit of `f278ad2`** (FRICTION-DECLARATION-TESTS): read the added
`describe("Dispatcher — Chain.friction load-time validation (§2)")` block
in `tests/Dispatcher.test.ts` against §2 and the `validateFrictionDeclaration`
it exercises (`src/Dispatcher.ts:177-197`). Four cases match the four
branches: absolute-path rejection, escapes-state-root rejection, valid
relative acceptance (asserts `mod.default.friction` stays the raw declared
string — correct, since neither `seedDir` nor `harvest` get resolved to an
absolute path at load either; resolution happens at each field's own use
site, not in `loadChainModule`), and undeclared strict no-op. Regexes
match the thrown messages precisely. Scope: only `tests/Dispatcher.test.ts`
touched, matching the entry's `files.edit` — the exact fence-gap last
tick's audit filed this entry to close is closed; no repeat of the
`d009f19`/`231440e` pattern.

Checked for undertested edges beyond the four spec-named branches: an
empty-string or `"."` friction value resolves (trivially) inside the
sentinel root under the current relative-path check and would pass
validation, landing friction files at `flumeDir`'s own root. Spec §2 does
not name this as a rejection case, and it's a degenerate declaration no
real chain would author — not filing it; noting here as a debt if it ever
surfaces as a real chain misconfiguration, not now.

No exit-2 propagation test exists at the `loadChainModule` call site for
any of its error branches (absolute-path, escapes-root, or the pre-existing
"must default-export a Chain" check) — consistent existing precedent
(`tests/Dispatcher.test.ts` tests all of these via `rejects.toThrow` at the
`loadChainModule` boundary, trusting the shared CLI error→exit-2 plumbing
rather than re-testing it per call site). Not a gap specific to this entry.

`5a5dee5` (the chore commit) is a mechanical pending.json diff (one entry
removed, no source changes) — internally consistent, nothing further to
audit.

## Queue (5)

`FRICTION-GITIGNORE` (open, next) → `TEARDOWN-HARDENING` →
`FRICTION-REVERT-NOTE` → `FRICTION-SURFACING` → `CHANGELOG-0-6-2`. One
entry is build-ready; the rest are chained behind it in shipping order.

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote only `.flume/plan/state.md` this tick — audit found no defect
  requiring a pending entry, no spec change to derive, no inbox to drain,
  nothing to promote. `pending.json`, `open-questions.md`, and `inbox.md`
  are untouched (identical to `HEAD`).
- Trunk: HEAD `5a5dee5` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
