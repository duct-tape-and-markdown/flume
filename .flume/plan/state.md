# State

Phase: **v0.7 line in flight** — 4 entries in `pending.json`, all
`gate.kind: "open"`. Mode this tick: **audit** (commit-delta since the
last `plan:` commit, `bca5930`, is 4 commits; the accompanying
spec-delta only closes an existing open question, no new derivation).

## This tick

**Commit-delta** (`bca5930..HEAD`, 4 commits): `090a903` (ship,
`EXIT-CODE-CONTRACT-DOC-DRIFT` + `CJS-CONTEXT-REFUSAL-TESTS` removed
from pending), `41d8557` (build, `CJS-CONTEXT-REFUSAL-TESTS`), `c769e30`
(build, `EXIT-CODE-CONTRACT-DOC-DRIFT`), `6005318` (chore, operator
commit resolving the `PROMPTS-BUILD-FENCE-INSTRUCTION` park).

- `c769e30` cross-checked against §4: `docs/CLI.md`'s tick/loop/job run
  sections and the `Dispatcher.ts` comment now name `EX_MOUNT_DEAD`
  (confirmed `= 69` at `src/Dispatcher.ts:520`) instead of the stale
  "logs and proceeds" prose, and pick up `EXIT-CODE-CONTRACT-COUNTS`'s
  errored-and-nothing-shipped / partial-success-stays-0 / summary-names-
  errors conditions. Matches §4's ruled contract and its 2026-07-29
  amendment verbatim. Doc/comment-only, declared files unchanged. No
  drift.
- `41d8557` cross-checked against §5: `tests/Dispatcher.test.ts` proves
  both empirical signatures (tsx 4.21 import-outside-module; tsx 4.23
  `ERR_MODULE_NOT_FOUND` + `%3Fnamespace%3D`) throw `CjsContextLoadError`
  naming `"type": "module"`, plus the false-positive guard (genuine
  missing-dependency `ERR_MODULE_NOT_FOUND` passes through unshadowed).
  `tests/cli.test.ts` locks `tickExitCode`'s usageError→2 branch and the
  render command's independent catch. Matches §5's acceptance line
  directly; only the two declared test paths touched. No drift.
- `090a903`'s ship (declared-files diff touched for both entries,
  correctly cleared from `pending.json`) — no drift.
- `6005318` is an operator-directed interactive-session commit (`chore`
  prefix), same class as `b578a41` — outside plan's audit concern as a
  phase tick, but it resolves a standing open question (below).

**Spec-delta** (`spec/RELEASE-v0.7.md` diff, via `6005318`): §13 gains a
2026-07-29 delivery note stating the `prompts/build.md` bullet was
applied by operator commit, is not loop-derivable, and no entry should
carry it — confirms the disposition plan already took last tick
verbatim. No new derivable work; closes `PROMPTS-BUILD-FENCE-INSTRUCTION`
(moved to the closed-questions log in `open-questions.md`).

**Drain**: `.flume/inbox.md` confirmed header-only on disk — nothing to
route.

**Promote**: no entry in `pending-now` carries `gate.kind: "blockedBy"`
— nothing to flip.

## Queue (4)

1. `IN-WORKTREE-GATE-REVERT-FOOTPRINT` — open (closes the exact
   blindness that produced `50cc3ac3`'s empty-delta maintain tick).
2. `BAY-DISCOVERY-WALKUP` — open.
3. `ENGINE-PIN-HANDSHAKE` — open.
4. `SETUP-WORKTREE-HELPER` — open.

Next tick's real work is a **build** tick picking off the queue head.

## Open questions (4)

Closed this pass:
- `PROMPTS-BUILD-FENCE-INSTRUCTION` — resolved by `6005318` + the §13
  delivery note; moved to the closed-questions log.

Unchanged from prior ticks:
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks).

## Writable-paths / trunk

- `pending.json`: untouched this tick — no commit in the delta warranted
  a pending-entry change; all 4 existing entries verified still accurate
  against current source.
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: `PROMPTS-BUILD-FENCE-INSTRUCTION` moved from the
  open list to the closed-questions comment block; the other four
  entries untouched.
- `inbox.md`: untouched (already empty, header-only).
- Trunk: HEAD `090a903` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not
  a plan concern).

Plan continues: no
