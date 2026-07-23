# State

Phase: **v0.5 cut queued** (`spec/RELEASE-v0.5.md`; §2–§8 surface shipped; §7 amendment + §11 cut derived this tick; v0.1–v0.4 frozen). Mode this tick: **derive**.

## This tick — derive from spec amendment `6cb9194`

Delta = 1 spec commit (`6cb9194`, human-authored); no build commits; inbox empty.

**Audit**: `6cb9194` touches only `spec/RELEASE-v0.5.md` (+37) — spec-lane, human-authored; nothing to cross-check.

**Derive (2 entries)**:
- **TESTS-TSC-GATE** (§7 amendment): tsconfig `include` += `tests/**/*`; fix the single TS2375 in `tests/Gate.test.ts:22`. Probe re-run this tick (temp extending tsconfig) confirms the spec's single-error claim — exactly one error, nothing else enters the program.
- **CUT-0-5-0** (§11, blockedBy TESTS-TSC-GATE): CHANGELOG reconcile `v0.3.1..HEAD` + bump to 0.5.0, commit `chore(release): cut 0.5.0` (precedent `9be3c0f`). Blocked so the cut lands last as the line's completion marker.

**OQs closed (2 → 0)**: OQ 1 (type-tests not gate-enforced) resolved by the §7 amendment — option (a), tests join tsconfig include. OQ 2 (line uncut, no spec anchor) resolved by §11 — option (a), one consolidated 0.5.0. Both removed.

**Drain**: none (inbox empty). **Promote**: none.

## Queue (2)

1. **TESTS-TSC-GATE** — open
2. **CUT-0-5-0** — blockedBy TESTS-TSC-GATE

After the cut ships, the v0.5 line is complete; next derivation trigger is a v0.6 spec file. npm publish of 0.5.0 stays a human act (§11).

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (2 entries), `.flume/plan/state.md`, `.flume/plan/open-questions.md` (emptied); inbox.md untouched (empty).
- Trunk: HEAD `6cb9194` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 33 of origin/main** at tick start (34 with this commit) — human push pending; §11 lets the cut land regardless of push order.

Plan continues: no
