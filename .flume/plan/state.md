# State

Phase: **v0.7 line in flight** — 5 of the original 6 queue entries shipped
(`GATECONTEXT-REPOROOT`, `GATECONTEXT-REPOROOT-TESTS`, `PREPACK-BUILD`,
`CLI-JUNCTION-SAFE-ENTRY`, `CLI-JUNCTION-SAFE-ENTRY-TESTS`), 3 entries
remain in queue. Mode this tick: **audit** (commit-delta non-empty; all
other dimensions empty).

## This tick (audit — 2 commits since 4b87b8f)

- Audited `13345ec` (test §3) + `8c29705` (ship) against
  `spec/RELEASE-v0.7.md` §3. `isInvokedDirectly` exported cleanly at
  `src/cli.ts:854` (one-line change, no behavior change). `tests/cli.test.ts`
  adds 4 unit tests: `argv[1] === undefined` guard, plain-import-never-runs
  guard, `realpathSync` throw → raw-comparison fallback, and a real
  win32-junction case matching the DEV-9191 shape from §3. Ran
  `vitest run tests/cli.test.ts -t junction`: 4/4 green.
- Files touched (`src/cli.ts`, `tests/cli.test.ts` in `13345ec`;
  `.flume/plan/pending.json` only in `8c29705`) match
  `CLI-JUNCTION-SAFE-ENTRY-TESTS`'s declared `files.edit` exactly — no
  scope creep.
- No spec drift: all three §3 guards (undefined, realpathSync-throws,
  import-alone-never-runs) plus the acceptance line are each asserted.
  No gap found, no open question to file.
- Spec-delta: none (`git diff 4b87b8f..HEAD -- spec/` empty) — no derive
  trigger. Inbox: empty — nothing to drain. Promote: `CJS-CONTEXT-REFUSAL`
  still `blockedBy EXIT-CODE-CONTRACT`, which is still present in
  `pending-now` — no flip. `pending.json` on disk already matches
  post-ship state; left unchanged (rewritten byte-identical).

## Queue (3)

1. `HARNESS-BLOCK-EFFECTIVE-FENCE` — open, `Prompt.ts` + `Dispatcher.ts` + docs worked-example rewrite.
2. `EXIT-CODE-CONTRACT` — open, the largest entry (mount-dead classification + loop/job-run shipped-vs-errored accounting).
3. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`.

## Open questions (0)

None live.

## Writable-paths / trunk

- `pending.json`: unchanged (already reflects the post-ship 3-entry queue).
- `open-questions.md`: unchanged (nothing to close or add).
- `inbox.md`: already empty, written back byte-identical.
- Trunk: HEAD `8c29705` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
