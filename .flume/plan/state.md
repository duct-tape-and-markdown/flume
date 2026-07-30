# State

Phase: **v0.7 line closing out, v0.8 line freshly authored**. Mode this
tick: **audit + derive** (commit-delta since the last `plan:` commit,
`cb695d6`, is three commits — two rule/spec commits and one operator
dogfood ship — with a substantial spec-delta and an empty inbox; derive
carries the heaviest weight this tick).

## This tick

**Commit-delta** (3 commits since `cb695d6`):
- `b327db3` (`chore(flume):`) — operator commit closing
  `SETUP-WORKTREE-DOGFOOD-ADOPTION`. Verified the diff directly:
  `.flume/chain.ts`'s `buildSetupWorktree` now calls the exported
  `setupWorktree(ctx.worktreePath)` helper; the hand-rolled `execFile`
  pnpm spawn and its now-unused `execFile`/`promisify` imports are gone.
  §11 dimension (3) genuinely lands. Open question closed.
- `b42468c` (`rules:`) — operator commit adding
  `.claude/rules/engine-boundary.md` and collaboration.md's "complexity
  is a signal" section, both cited as `CLAUDE.md` Non-Negotiables. Rules
  layer, human-authored per `spec-plan-build.md`'s table — no plan
  action; scoped correctly (rules + CLAUDE.md pointer only, no `src/`
  touched).
- `5c67ee0` (`spec:`) — v0.7 drain amendment (§10 amendment, §§15-17
  new) plus authoring `spec/RELEASE-v0.8.md` (the boundary line, §§1-9)
  from scratch. This is the tick's real work — see Spec-delta below.

**Spec-delta**: both `spec/RELEASE-v0.7.md` (amended) and
`spec/RELEASE-v0.8.md` (new file) changed since `cb695d6` — full derive
dimension triggered on both. Processed v0.7's amendment in full this
tick (4 sections, all mechanical, no open design calls left after the
operator's own rulings); v0.8 not started — see Cut below.

**Derive — v0.7 amendment, filed as 5 entries** (queue order below is
priority; none blockedBy any other, all independently shippable):
1. `TICKRESULT-NOCOMMIT-CLASSIFICATION` (§15) — `TickResult.noCommit`
   field + `Dispatcher.tick` folds it in. Dogfood chain wake-condition
   edit stays operator-applied per the section's own note — not filed.
2. `ENGINE-PIN-HANDSHAKE-JOB-SCOPE` (§10 amendment) — resolves
   `ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH`: swap the fixed bay-root
   check path for the `resolveStateDirs`-derived one. Flagged a real
   ordering wrinkle in the entry's `notes` (handshake runs before `--job`
   extraction in `main()`) rather than resolving it myself — mechanical
   either way, build's call.
3. `STATUS-SUPERVISOR-LIVENESS` (§17, ask 2) — `status` probes
   `loop.pid` liveness.
4. `DROPLASTCOMMIT-TIP-OWNERSHIP` (§17, ask 3) — `dropLastCommit` checks
   current tip against the sha it itself just created before resetting.
   Traced both callsites (`src/Dispatcher.ts`, ~lines 781 and 1290):
   each already holds its own `postHead` in scope, so this is a
   same-call check, no cross-process state needed — simpler than the
   spec's "supervisor remembers" phrasing implies.
5. `SUPERVISOR-PROVISION-QUARANTINE` (§16) — per-entry quarantine +
   3-consecutive-identical-failure abort, ruled as both legs together.
   Largest of the five; filed as one entry since the ruling explicitly
   rejects either leg alone.

Split §17's two asks into separate entries (`STATUS-SUPERVISOR-LIVENESS`
/ `DROPLASTCOMMIT-TIP-OWNERSHIP`) since they touch disjoint code paths
(`cli.ts` status vs. `git.ts`+`Dispatcher.ts`) and ship independently —
one spec section, two shippable units. §17 ask 1 (loop-lock liveness
probe) stays unfiled: already verified implemented, no gap, no entry.

**Cut — v0.8 not derived this tick.** `spec/RELEASE-v0.8.md` is a fresh
8-section line (schema core/extension split, tag grammar, capability
gate, tick-verdict artifact, `pendingGate` builtin, second reference
chain, supervisor policy knobs) — a full pass would dilute quality
against the v0.7 amendment work above, which had operator rulings ready
to act on mechanically. Three of the seven closed open questions
(`TAG-PATTERN-SLICE-CONSTRAINT`, and implicitly `PENDING-NOTES-CAP-
VISIBILITY`) now point at v0.8 §§2-3 rather than carrying their own
entries — no entry filed for either this tick; they'll be picked up
naturally when v0.8 §2-3 are derived.

Ordering note for next tick: §2 (core/extension schema split) is the
dependency root — §3 (tag grammar refinement) and §6 (`pendingGate`
composed validation) both build on its extension-declaration mechanism.
§4 (`requiresCapability`) and §5 (tick-verdict artifact) read as
independent of §2 and could go in parallel/first. §7 (second reference
chain) and §8 (policy knobs) are last — §7 needs §§2-4 landed to exercise
them from a second angle, §8 builds on this tick's own
`SUPERVISOR-PROVISION-QUARANTINE` (§16) shipping first.

**Drain**: `.flume/inbox.md` is header-only — nothing to route.

**Promote**: `pending-now` was `[]` at tick start — no entry carried
`gate.kind: "blockedBy"` to flip. All 5 new entries filed this tick are
`gate.kind: "open"` (none blocks another).

## Queue (5)

1. `TICKRESULT-NOCOMMIT-CLASSIFICATION` — open
2. `ENGINE-PIN-HANDSHAKE-JOB-SCOPE` — open
3. `STATUS-SUPERVISOR-LIVENESS` — open
4. `DROPLASTCOMMIT-TIP-OWNERSHIP` — open
5. `SUPERVISOR-PROVISION-QUARANTINE` — open

All five pickable for build immediately; none blocked.

## Open questions (0)

All seven prior questions closed this tick — see open-questions.md's
closed-comment block for per-question disposition. Two
(`TAG-PATTERN-SLICE-CONSTRAINT`, `PENDING-NOTES-CAP-VISIBILITY`) close
into v0.8 §§2-3 without a pending entry yet (v0.8 not derived this
tick, see Cut above); the other five close into filed entries or
verified-already-implemented, no residual action.

## Writable-paths / trunk

- `pending.json`: `[]` → 5 entries (this tick's derive output).
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: rewritten — all seven prior questions moved to
  the closed-comment block with disposition notes; file is otherwise
  empty (no open questions).
- `inbox.md`: untouched — already header-only, nothing to drain.
- Trunk: HEAD `5c67ee0` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not a
  plan concern).

Plan continues: yes — v0.8 derive dimension not started (`spec/RELEASE-v0.8.md` §§2-9); next tick begins there per the ordering note above.
