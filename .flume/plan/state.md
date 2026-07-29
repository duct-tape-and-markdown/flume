# State

Phase: **v0.7 line in flight** — 1 of the original 6 queue entries shipped
(`GATECONTEXT-REPOROOT`), 5 remain, 1 new entry filed this tick. Mode this
tick: **audit** (commit-delta was the only non-empty dimension).

## This tick (audit — 2 commits since a3acea8)

- `git log --grep='^plan:' -n 1` → `a3acea8` (last plan). `git log
  a3acea8..HEAD` → `94b0ec2` (build ships `GATECONTEXT-REPOROOT`),
  `8f4f4f9` (harness auto-commit dropping the shipped entry from
  `pending.json`). No spec-delta (`git diff a3acea8..HEAD -- spec/`
  empty), inbox already empty, one `blockedBy` entry unchanged — audit
  was the only live dimension.
- **Cross-checked `94b0ec2` against §6** (`GateContext.repoRoot`): field
  added at both construction sites (`src/Dispatcher.ts:799` afterMerge,
  `:1167` afterCommit), matches §6's fanout-worktree-root /
  bare-primary-checkout split, CHANGELOG bullet accurate, stayed inside
  declared `files`. Checked §1's "kills a helper every gate reinvents"
  framing against `src/builtinGates.ts` — none of flume's own built-in
  gates independently compute a repo root (they use `ctx.cwd`), so
  nothing there needed touching; that framing targets external consumer
  chains, out of this repo's blast radius. No spec drift found.
- **Found the real gap**: build shipped `repoRoot` as optional
  specifically to avoid touching `tests/Gate.test.ts` /
  `tests/Dispatcher.test.ts`, which the entry's `files` had omitted even
  though its `tests[]` cited them — an under-declaration in last tick's
  derive (`a3acea8`), not a build defect. Build correctly refused to
  reach outside its fence and logged the gap to `open-questions.md`
  instead (the build→plan channel per
  `.claude/rules/collaboration.md`).
- **Inform-before-parking**: re-read §6 and this doc's own
  Derive-dimension rule ("Tests ride the entry... test paths in files")
  — the fix was already the standing convention, not a fresh decision.
  Filed `GATECONTEXT-REPOROOT-TESTS` (`files` includes both test paths
  this time) and closed the carried open question by routing rather than
  parking it further.
- **Promote**: `CJS-CONTEXT-REFUSAL` still `blockedBy EXIT-CODE-CONTRACT`;
  `EXIT-CODE-CONTRACT` still present and `open` in the queue — block
  doesn't lift, checked mechanically.

## Queue (6)

1. `GATECONTEXT-REPOROOT-TESTS` — open, new this tick, closes last
   tick's under-declaration debt.
2. `PREPACK-BUILD` — open, `package.json` only.
3. `CLI-JUNCTION-SAFE-ENTRY` — open, `src/cli.ts` only.
4. `HARNESS-BLOCK-EFFECTIVE-FENCE` — open, `Prompt.ts` + `Dispatcher.ts`
   + docs worked-example rewrite.
5. `EXIT-CODE-CONTRACT` — open, the largest entry (mount-dead
   classification + loop/job-run shipped-vs-errored accounting).
6. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`.

## Open questions (0)

None live — the one carried question closed this tick by routing to
`GATECONTEXT-REPOROOT-TESTS`.

## Writable-paths / trunk

- `pending.json`: 1 entry added (`GATECONTEXT-REPOROOT-TESTS`), 5 written
  back byte-identical.
- `open-questions.md`: 1 question closed (moved into the closed-questions
  comment), header/status-marker block unchanged.
- `inbox.md`: already empty, written back byte-identical.
- Trunk: HEAD `8f4f4f9` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
