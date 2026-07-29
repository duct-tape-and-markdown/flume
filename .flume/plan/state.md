# State

Phase: **v0.7 line in flight** — 3 of the original 6 queue entries shipped
(`GATECONTEXT-REPOROOT`, `GATECONTEXT-REPOROOT-TESTS`, `PREPACK-BUILD`), 4
remain. Mode this tick: **audit** (commit-delta was the only non-empty
dimension; spec-delta empty, inbox empty, no blocks to promote).

## This tick (audit — 3 commits since 314c2e3)

- `git log --grep='^plan:' -n 1` → `314c2e3` (last plan). `git log
  314c2e3..HEAD` → `7c6c2d6` (build ships `GATECONTEXT-REPOROOT-TESTS`),
  `999eb5c` (build ships `PREPACK-BUILD`), `840586b` (harness auto-commit
  dropping both shipped entries from `pending.json`). No spec-delta
  (`git diff 314c2e3..HEAD -- spec/` empty), inbox already empty, the one
  `blockedBy` entry (`CJS-CONTEXT-REFUSAL`) still blocked on
  `EXIT-CODE-CONTRACT`, which is still present and `open` — audit was
  the only live dimension.
- **Cross-checked `7c6c2d6` against §6's acceptance line**
  (`GateContext.repoRoot`): `Gate.test.ts` asserts `repoRoot` round-trips
  through `ctx()` overrides and stays `undefined` when omitted;
  `Dispatcher.test.ts` asserts a singleton tick's gate sees
  `repoRoot === cwd === trunk`, and a fanout tick's `afterCommit` gate
  sees the worktree root (`repoRoot === cwd`, `!== fx.repo`, contains the
  worktree slug) while its `afterMerge` gate sees the trunk. Matches §6's
  fanout-worktree-root / bare-primary-checkout split exactly; stayed
  inside the entry's declared `files`. No drift.
- **Cross-checked `999eb5c` against §7**: `"prepack": "pnpm build"` added
  to `package.json`; `scripts/smoke-install.mjs` shells out via `npm
  pack` (confirmed at `scripts/smoke-install.mjs:87-90`), so npm's own
  lifecycle runs `prepack` on the *root* package (not a dependency) —
  pnpm's dependency-script-blocking policy doesn't apply here, no
  false-safety concern. CHANGELOG bullet (`CHANGELOG.md:19-22`) matches.
  No drift.
- **`840586b`**: harness auto-commit, correctly dropped exactly the two
  shipped tags from `pending.json`, left the other four byte-identical.
  No audit action needed beyond the mechanical check.
- **Promote**: `CJS-CONTEXT-REFUSAL` still `blockedBy EXIT-CODE-CONTRACT`;
  `EXIT-CODE-CONTRACT` still present and `open` — block doesn't lift,
  checked mechanically.
- **Drain**: inbox empty, nothing to route.

## Queue (4)

1. `CLI-JUNCTION-SAFE-ENTRY` — open, `src/cli.ts` only.
2. `HARNESS-BLOCK-EFFECTIVE-FENCE` — open, `Prompt.ts` + `Dispatcher.ts`
   + docs worked-example rewrite.
3. `EXIT-CODE-CONTRACT` — open, the largest entry (mount-dead
   classification + loop/job-run shipped-vs-errored accounting).
4. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`.

## Open questions (0)

None live.

## Writable-paths / trunk

- `pending.json`: unchanged (no drift found; written back byte-identical
  — 4 entries).
- `open-questions.md`: unchanged, byte-identical.
- `inbox.md`: already empty, written back byte-identical.
- Trunk: HEAD `840586b` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
