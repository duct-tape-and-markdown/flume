# State

Phase: **v0.7 line in flight, queue empty**. Mode this tick: **audit**
(commit-delta since the last `plan:` commit, `a8091ba`, is two commits —
a `build:` ship and a `chore(flume):` clear — with no spec-delta and an
empty inbox; audit is the only dimension carrying real content).

## This tick

**Commit-delta** (2 commits since `a8091ba`):
- `5a56f7a` (`build:`) — ships the `setupWorktree` lockfile-aware helper
  per `spec/RELEASE-v0.7.md` §11. Cross-checked the diff against §11's
  three named deliverables: (1) helper ships at `src/setupWorktree.ts`,
  re-exported from `src/index.ts` alongside `builtinGates`, matching the
  spec's three branches (pnpm-lock.yaml → `pnpm install
  --frozen-lockfile`; package-lock.json → `npm ci`; neither → clean
  refusal) — verified `tests/setupWorktree.test.ts` covers all three plus
  both-present (pnpm wins) and install-failure-propagates edge cases; (2)
  `docs/CHAIN-AUTHORING.md`'s worked example rewritten to show the helper
  as the recommended default; CHANGELOG bullet present. (1) and (2) are
  genuinely shipped and correct. (3) — "Flume's own dogfood chain
  (`.flume/chain.ts`) adopts the helper in place of `buildSetupWorktree`"
  — was correctly *not* attempted by this commit, since the re-filed
  entry (last tick) dropped `.flume/chain.ts` from `files.edit` as
  off-fence for build.
- `ac8c973` (`chore(flume):`) — clears `SETUP-WORKTREE-HELPER` from
  `pending.json` (ship-detection: the commit's files matched the entry's
  declaration exactly). But this leaves §11 dimension (3) permanently
  unshipped with no queue entry tracking it — verified this tick via
  `grep` that `.flume/chain.ts:95-103`'s `buildSetupWorktree` still
  hand-rolls `pnpm install --frozen-lockfile` directly, no reference to
  the new exported helper.

Routed as a new open question, **SETUP-WORKTREE-DOGFOOD-ADOPTION**
(PARKED) — not NEEDS AMENDMENT, because no spec gap exists (§11 already
names the deliverable); the blocker is purely the writable-paths fence
(neither build's nor plan's `writablePaths` reach `.flume/chain.ts`).
Same shape and same resolution path as the already-closed
PROMPTS-BUILD-FENCE-INSTRUCTION: needs a direct operator `chore(flume):`
commit, not a phase entry.

**Spec-delta**: none (`git diff a8091ba..HEAD -- spec/` empty).

**Drain**: `.flume/inbox.md` is header-only — nothing to route.

**Promote**: `pending-now` is `[]` — no entry carries `gate.kind:
"blockedBy"` to flip.

## Queue (0)

`pending.json` stays `[]`. Nothing pickable for build this cycle; the
only actionable item (dogfood adoption) is fence-blocked for every phase
and now lives in open-questions.md awaiting an operator commit.

## Open questions (7)

- `SETUP-WORKTREE-DOGFOOD-ADOPTION` — PARKED (new this tick, see Drain
  above).
- `HANDOFF-NOCOMMIT-BLIND` — NEEDS AMENDMENT, unchanged.
- `ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH` — PARKED, unchanged.
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT, unchanged.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT, unchanged.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED, unchanged.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT (2
  of 3 asks), unchanged.

## Writable-paths / trunk

- `pending.json`: unchanged (`[]` at tick start and end — nothing to
  add, nothing to promote).
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: appended `SETUP-WORKTREE-DOGFOOD-ADOPTION`; all
  six prior questions left byte-identical.
- `inbox.md`: untouched — already header-only, nothing to drain.
- Trunk: HEAD `ac8c973` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not a
  plan concern).

Plan continues: no
