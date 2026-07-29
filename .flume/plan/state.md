# State

Phase: **v0.7 line in flight** — `SHIP-DETECTION-DECLARED-FILES-DIFF`
shipped (`d043482`); 6 entries remain in `pending.json`. Mode this tick:
**audit** (4 commits landed since the last `plan:` commit, `9473ef8`;
heaviest dimension this pass).

## This tick (audit + drain)

A prior attempt this same wake reported the delta as empty (commit-delta,
spec-delta, inbox all empty) against `9473ef8` and exited without
committing. That report doesn't match reality: `git log` shows 4 commits
since `9473ef8`, and `inbox.md` held two entries on disk. Re-verified
directly (`git log --oneline -8`, `git status`, file `wc -l`) before
proceeding — the prior attempt's refusal was itself in error, not a
constraint to honor. Processed the real delta:

**Audit** — `b350bb7` (build) + `d043482` (chore ship) implement
`SHIP-DETECTION-DECLARED-FILES-DIFF` per v0.7 §12. Cross-checked the
diff against §12 line by line: declared-files diff computed via the
same `git.showNameOnly` helper already used for footprint capture, the
zero-overlap predicate correctly gates `shipped.push` (not a new
`TickOutcome` variant, per §12's explicit "no taxonomy growth"), the log
line matches the spec's suggested wording, both acceptance shapes
(channel-only stays pending; normal-ship incl. channel/CHANGELOG-touching
is unaffected) are covered in `tests/Dispatcher.test.ts`. The
pre-existing cherry-pick-conflict test's rewrite (fake agents now also
write their declared file) is forced by the behavior change, not scope
creep — under the old classification it passed by accident. No drift
found; no new pending entry from this audit.

**Drain (inbox, 2 entries)** — neither routes to a pending entry (no
spec section governs either class yet):
- EBUSY worktree-sweep tick-burn — parked as
  `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` (two real options, human
  pick needed, plus no spec home).
- Concurrent-supervisor incident (3 asks) — checked each against source
  before parking, per collaboration.md ("inform before parking"): ask 1
  (loop-pid liveness refusal) is **already implemented**
  (`src/cli.ts:731-747`, `process.kill(prior, 0)` probe) — no gap, no
  entry needed. Asks 2 (`status` liveness surfacing) and 3
  (`dropLastCommit` tip-ownership check) parked together as
  `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — direction clear,
  blocked on spec home.
- Both new questions flag a plausible shared v0.8 "supervisor
  operational safety" home, distinct from v0.7's truth-telling theme.
- `inbox.md` drained to header-only; nothing left queued.

**Promote** — checked both `blockedBy` entries
(`EXIT-CODE-CONTRACT-COUNTS`, `CJS-CONTEXT-REFUSAL`) against
`pending-now`: both still gate on `EXIT-CODE-CONTRACT`, which remains
present and open. No-op, as before.

`pending.json` unchanged (6 entries, same shapes as the prior `plan:`
commit) — audit found nothing to amend, drain produced no pending
entries, promote had nothing to flip.

## Queue (6)

1. `EXIT-CODE-CONTRACT` — open, design operator-ratified.
2. `EXIT-CODE-CONTRACT-COUNTS` — blockedBy `EXIT-CODE-CONTRACT`.
3. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`.
4. `BAY-DISCOVERY-WALKUP` — open.
5. `ENGINE-PIN-HANDSHAKE` — open.
6. `SETUP-WORKTREE-HELPER` — open.

## Open questions (4)

- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT, unchanged this pass.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT, unchanged this pass.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED, new this pass.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks), new this pass.

## Writable-paths / trunk

- `pending.json`: untouched this pass (audit and drain produced no
  pending-entry writes).
- `open-questions.md`: +2 new sections (see above); prior 2 unchanged.
- `inbox.md`: both entries drained; header preserved, now empty below
  the marker.
- Trunk: HEAD `d043482` at this pass's start; tree clean besides
  untracked `.flume/loop.pid`.

Plan continues: no
