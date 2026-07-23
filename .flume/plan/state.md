# State

Phase: **v0.5 cut queued** (`spec/RELEASE-v0.5.md`; §2–§8 surface shipped incl. §7 gate-enforced type tests; only the §11 cut remains; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit TESTS-TSC-GATE ship

Delta = 2 commits (`998a20d` build, `89d8504` chore ship); no spec delta; inbox empty.

**Audit `998a20d` vs §7 amendment**: clean. tsconfig `include` += `tests/**/*` (exact spec text); the one predicted TS2375 in `tests/Gate.test.ts` fixed in the same commit by defaulting `flumeDir` to `join(cwd, ".flume")` — matches the documented default state root, no behavior change (builtin gates never read it). Files touched = files declared (`tsconfig.json`, `tests/Gate.test.ts`); no scope creep, no gate-bypass. Commit body correctly frames the why (LSP-only assertions aren't tests).

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none needed — the chore ship already flipped CUT-0-5-0 to open; notes updated to reflect the unblock.

## Queue (1)

1. **CUT-0-5-0** — open, next. CHANGELOG reconcile `v0.3.1..HEAD` + bump to 0.5.0, commit `chore(release): cut 0.5.0` (precedent `9be3c0f`).

After the cut ships, the v0.5 line is complete; next derivation trigger is a v0.6 spec file. npm publish of 0.5.0 stays a human act (§11).

## Open questions

None.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (1 entry, notes refreshed), `.flume/plan/state.md`; open-questions.md and inbox.md untouched (both empty).
- Trunk: HEAD `89d8504` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 36 of origin/main** at tick start (37 with this commit) — human push pending; §11 lets the cut land regardless of push order.

Plan continues: no
