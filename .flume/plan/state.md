# State

Phase: **v0.7 line in flight** — HARNESS-BLOCK-EFFECTIVE-FENCE shipped
(6 of 6 original queue entries landed). Mode this tick: **derive**
(spec-delta added v0.7 §9-§12, the largest driver), riding alongside a
real audit finding and a full inbox drain.

## This tick (derive + audit + drain)

**Delta correction first.** The `<last-plan>` cite (`5396d5a`) and the
`<commit-delta>`/`<pending-now>` context handed to this tick described a
third commit, `19be056` (`chore(flume): ship EXIT-CODE-CONTRACT`), on top
of `f5b60e1` and `4933e31`. Checking actual HEAD before writing anything:
`git log`/`git reflog` show HEAD is `f5b60e1` — `19be056` was committed,
then reset away (`HEAD@{0}: reset: moving to HEAD~1`) before this tick
started. It was a bogus ship: `f5b60e1` (the commit it shipped) touched
only `.flume/plan/open-questions.md` — a park, no implementation — so
`19be056` was `SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS` firing for real,
caught and reverted by an operator rather than by the harness. Net
effect: `EXIT-CODE-CONTRACT` was never actually dropped from
`pending.json` and `CJS-CONTEXT-REFUSAL` was never actually promoted —
this tick's real commit-delta is 2 commits (`4933e31`, `f5b60e1`), not 3,
and no repair-write to `pending.json` was needed for that half. The
near-miss is folded into `SHIP-DETECTION-DECLARED-FILES-DIFF`'s notes as
evidence the class is live, not hypothetical.

**Derive (spec-delta, primary driver).** `spec/RELEASE-v0.7.md` §9-§12
appended since `5396d5a`. Filed four entries: `BAY-DISCOVERY-WALKUP`
(§9), `ENGINE-PIN-HANDSHAKE` (§10, all four candidate hosting files —
`src/cli.ts`, `bin/flume.js`, `bin/flume` — declared since the exact
re-exec site is build's call), `SETUP-WORKTREE-HELPER` (§11, new
`src/setupWorktree.ts` + test), `SHIP-DETECTION-DECLARED-FILES-DIFF`
(§12 — closes the long-parked `SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS`
question, given a spec home at last; placed first in queue given the
near-miss above).

**Audit (commit-delta, secondary).** `f5b60e1`'s park write-up
(`EXIT-CODE-CONTRACT` open question) had already converged on option 2
(split, smaller blast radius) with its own reasoning laid out — per
`.claude/rules/collaboration.md`'s *Inform before parking* ("if research
yields a clear answer, propose it directly, skip the park"), acted on it
directly instead of re-parking: `EXIT-CODE-CONTRACT` re-derived as
abort-only with its forced test edits (`tests/Dispatcher.test.ts`,
`tests/cli.test.ts`, `tests/loop-process-boundary.integration.test.ts`)
folded into `files.edit`; shipped/errored counting split into a new
follow-up, `EXIT-CODE-CONTRACT-COUNTS`, blocked on it, with a design
committed in its notes (per-tick disk artifact, disk-is-truth) so build
isn't left deciding that API surface. `4933e31`'s spec append itself
checked out — verbatim heading matches, `per` cites resolve.

**Drain (inbox, both entries routed).** Neither `TAG_PATTERN` slice
mismatch nor the `notes` cap-visibility finding can carry a `per` cite —
no shipped spec section governs `PendingSchema.ts` self-consistency
(v0.7 §1 names this exact failure class but its blast radius excludes
that file). Both routed to `open-questions.md` as NEEDS AMENDMENT
(`TAG-PATTERN-SLICE-CONSTRAINT`, `PENDING-NOTES-CAP-VISIBILITY`),
recommended fix directions stated, folding-into-one-spec-entry suggested
once a human opens the home. `inbox.md` drained to header-only.

**Promote (mechanical).** `CJS-CONTEXT-REFUSAL`'s `blockedBy` tag
(`EXIT-CODE-CONTRACT`) is still present in `pending.json` as `open` —
condition for flipping to `open` not met. No promotion.

## Queue (7)

1. `SHIP-DETECTION-DECLARED-FILES-DIFF` — open. Ship soon; closes the
   class that just near-missed.
2. `EXIT-CODE-CONTRACT` — open, redesigned (abort-only, tests folded in).
3. `EXIT-CODE-CONTRACT-COUNTS` — blockedBy `EXIT-CODE-CONTRACT` (new).
4. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`, unchanged.
5. `BAY-DISCOVERY-WALKUP` — open (new, v0.7 §9).
6. `ENGINE-PIN-HANDSHAKE` — open (new, v0.7 §10).
7. `SETUP-WORKTREE-HELPER` — open (new, v0.7 §11).

## Open questions (2)

- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT, filed this tick.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT, filed this tick.
- (`SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS` and the prior
  `EXIT-CODE-CONTRACT` park both closed this tick — see above.)

## Writable-paths / trunk

- `pending.json`: 7 entries, verified `git show HEAD` before editing to
  establish ground truth (the handed-in `<pending-now>` context was
  stale relative to the operator's reset).
- `open-questions.md`: two closures moved into the collapsed comment
  block, two new NEEDS AMENDMENT questions added above it.
- `inbox.md`: both entries drained, header preserved.
- Trunk: HEAD `f5b60e1` at tick start (2 commits ahead of `5396d5a`, not
  3 — see delta correction above); tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
