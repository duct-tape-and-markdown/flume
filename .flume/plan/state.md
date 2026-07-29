# State

Phase: **v0.7 line in flight** — 6 entries in `pending.json`, all
`gate.kind: "open"`. Mode this tick: **audit + derive** (commit-delta
and spec-delta both non-empty since the last `plan:` commit, `50cc3ac3`
— *not* `d9b995d` as this tick's stale `<state>` input implied; verified
directly via `git log --grep='^plan:'`).

## This tick

**Commit-delta** (`50cc3ac3..HEAD`, 3 commits):
`b578a41` (chore, fence feedback — `tests/**` joins `entryChannelPaths`;
spec §13 added, old §13 CHANGELOG renumbered §14), `2d7b9f5` (build,
CJS-CONTEXT-REFUSAL), `9cb413c` (ship, CJS-CONTEXT-REFUSAL removed from
pending).

- Cross-checked `2d7b9f5` against §5: message shape, exit-2 wiring, and
  detection regexes (`CJS_CONTEXT_IMPORT_OUTSIDE_MODULE`,
  `CJS_CONTEXT_NAMESPACE_QUERY`) all match §5's acceptance line. **Gap
  found**: the entry's own `tests[]` demanded `tests/Dispatcher.test.ts`
  + `tests/cli.test.ts` coverage; the shipped commit touched neither,
  citing a prior tests-outside-declared-files revert (`4300b81`) — but
  `b578a41`, landed *earlier in this same delta*, already added
  `tests/**` to `entryChannelPaths`, mooting that risk before `2d7b9f5`
  ran. Confirmed zero `CjsContext`/`CJS` matches in `tests/` on disk.
  Filed `CJS-CONTEXT-REFUSAL-TESTS`.
- `9cb413c`'s ship (declared-files diff touched, entry correctly
  cleared) — no drift.
- `b578a41`'s own `chain.ts`/`spec/` edits are outside plan's audit
  concern (operator-directed interactive session, not a phase tick).

**Spec-delta** (`spec/RELEASE-v0.7.md` diff, via `b578a41`): new §13
"In-worktree gate reverts leave a trunk footprint"; old §13 CHANGELOG
renumbered §14.

- Derived §13 as `IN-WORKTREE-GATE-REVERT-FOOTPRINT`. Read the actual
  control flow to ground the entry: the wave loop's
  `if (!r.committed || !r.commitSha) continue` (`Dispatcher.ts:936`)
  skips the `observed`-footprint capture (`~L1010`,
  `commitPendingUpdate` `~L975-1002`) entirely for entries reverted
  in-worktree at the `afterCommit` gate (`~L1247-1266`) — only
  afterMerge-reverted entries reach it today, confirming the spec's
  claim directly against source rather than trusting the prose.
- §13's third bullet (a `prompts/build.md` instruction) is **not**
  build-writable — `chain.ts`'s writablePaths comment explicitly
  excludes `.flume/{chain.ts,prompts/**}`, and plan's own writable set
  doesn't cover it either. Routed to `open-questions.md`
  (`PROMPTS-BUILD-FENCE-INSTRUCTION`) rather than folded into the
  pending entry or silently dropped.
- **Audit side-effect of the renumbering**: three existing entries'
  `files.edit` descriptions cited "Add bullet ... per §13" for
  CHANGELOG.md — now stale since §13 was renumbered §14. Fixed in place
  (`BAY-DISCOVERY-WALKUP`, `ENGINE-PIN-HANDSHAKE`,
  `SETUP-WORKTREE-HELPER`) — text-only, no entry re-derivation needed.

**Drain**: `.flume/inbox.md` confirmed header-only on disk — nothing to
route.

**Promote**: no entry in `pending-now` carries `gate.kind: "blockedBy"`
— nothing to flip.

## Queue (6)

1. `EXIT-CODE-CONTRACT-DOC-DRIFT` — open (doc-only, quick).
2. `IN-WORKTREE-GATE-REVERT-FOOTPRINT` — open (new; closes the exact
   blindness that produced `50cc3ac3`'s empty-delta maintain tick).
3. `CJS-CONTEXT-REFUSAL-TESTS` — open (new; closes a shipped-without-
   tests gap).
4. `BAY-DISCOVERY-WALKUP` — open.
5. `ENGINE-PIN-HANDSHAKE` — open.
6. `SETUP-WORKTREE-HELPER` — open.

Next tick's real work is a **build** tick picking off the queue head.

## Open questions (5)

New this pass:
- `PROMPTS-BUILD-FENCE-INSTRUCTION` — PARKED (no phase writes
  `.flume/prompts/**`; needs a human/interactive edit, same pattern as
  `b578a41`'s own chain.ts touch).

Unchanged from prior ticks:
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks).

## Writable-paths / trunk

- `pending.json`: 4 existing entries kept (3 with a §13→§14 text fix),
  2 new entries added (`IN-WORKTREE-GATE-REVERT-FOOTPRINT`,
  `CJS-CONTEXT-REFUSAL-TESTS`) — validated `node -e` parse, tag-pattern,
  and summary/notes cap compliance directly before commit.
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: one new entry appended
  (`PROMPTS-BUILD-FENCE-INSTRUCTION`); prior four untouched.
- `inbox.md`: untouched (already empty, header-only).
- Trunk: HEAD `9cb413c` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not
  a plan concern).

Plan continues: no
