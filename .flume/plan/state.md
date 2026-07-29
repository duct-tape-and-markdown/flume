# State

Phase: **v0.7 line in flight** — HARNESS-BLOCK-EFFECTIVE-FENCE shipped
(6 of 6 original queue entries landed). Mode this tick: **derive**
(a second, smaller pass this same session: `b732490` landed a §4
spec amendment seconds after the prior `plan:` commit).

## This tick (derive — operator's §4 amendment)

The prior `plan:` commit (`8f44350`) filed `EXIT-CODE-CONTRACT` /
`EXIT-CODE-CONTRACT-COUNTS` with a design proposed in each entry's own
notes (distinct exit constant; per-tick disk artifact for counts) since
neither had a spec ruling to point at yet. Before ending that turn,
`b732490` (`spec: §4 amendment — mount-dead exit constant,
locked-assertion rewrite authorized, shipped/errored counts cross by
disk artifact`) landed — the operator ratifying, point for point, the
same design. Processed as a fresh spec-delta rather than left for an
unscheduled next tick:

- `EXIT-CODE-CONTRACT`: `src/Dispatcher.ts`'s file description tightened
  to state the ratified distinct exit constant (the "or a TickOutcome
  field" alternative is now closed, not open); notes updated to cite the
  amendment's explicit authorization of the `cli.test.ts:211` /
  `Dispatcher.test.ts:2995` semantics rewrite (no longer "build's call
  whether this is scope creep" — the operator settled it).
- `EXIT-CODE-CONTRACT-COUNTS`: notes updated to cite the amendment's
  ruling directly (exit codes carry class only; disk artifact carries
  counts; stdio stays `inherit`, piped-and-parsed stdout explicitly
  declined) instead of presenting it as plan's own proposal.
- No `per.section` change needed — the amendment landed inline in
  spec §4 (no new heading), so the existing cite
  (`spec/RELEASE-v0.7.md`, "4. Exit-code contract — the run never lies
  to CI") still resolves and still covers it.
- No other entry affected; `open-questions.md` and `inbox.md` unchanged
  from the prior commit this tick (nothing in the amendment touches
  either).

## Queue (7)

1. `SHIP-DETECTION-DECLARED-FILES-DIFF` — open.
2. `EXIT-CODE-CONTRACT` — open, design now operator-ratified.
3. `EXIT-CODE-CONTRACT-COUNTS` — blockedBy `EXIT-CODE-CONTRACT`, design ratified.
4. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`, unchanged.
5. `BAY-DISCOVERY-WALKUP` — open.
6. `ENGINE-PIN-HANDSHAKE` — open.
7. `SETUP-WORKTREE-HELPER` — open.

## Open questions (2)

- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT, unchanged this pass.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT, unchanged this pass.

## Writable-paths / trunk

- `pending.json`: 7 entries; only the two `EXIT-CODE-CONTRACT*` entries'
  `files[].description`/`notes` touched this pass.
- `open-questions.md` / `inbox.md`: unchanged from the prior commit this
  tick.
- Trunk: HEAD `b732490` at this pass's start; tree clean besides
  untracked `.flume/loop.pid`.

Plan continues: no
