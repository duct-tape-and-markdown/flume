# State

Phase: **v0.7 line in flight** — 4 of the original 6 queue entries shipped
(`GATECONTEXT-REPOROOT`, `GATECONTEXT-REPOROOT-TESTS`, `PREPACK-BUILD`,
`CLI-JUNCTION-SAFE-ENTRY`), 3 original entries remain plus 1 filed this
tick. Mode this tick: **audit** (commit-delta non-empty; all other
dimensions empty).

## This tick (audit — 2 commits since 4fcb200)

- Audited `08c2ace` (realpath fix) + `6bd63c6` (ship commit) against
  `spec/RELEASE-v0.7.md` §3. Read `src/cli.ts:845-874`: `isInvokedDirectly`
  matches all three §3 guards verbatim — `argv1 === undefined` → not
  direct, `realpathSync` throw → falls back to raw comparison, import
  alone never runs `main()`. No spec drift, no scope creep beyond
  `CLI-JUNCTION-SAFE-ENTRY`'s declared files (`src/cli.ts`,
  `CHANGELOG.md`).
- Gap found: §3's acceptance line ("dist/cli.js reached through a
  directory junction executes...; a plain module import runs nothing")
  has no test asserting it — `08c2ace`'s commit body already flagged this
  and parked it as `NEEDS AMENDMENT` in open-questions.md (fence: the
  commit's declared `files` didn't include `tests/cli.test.ts`, and
  `ae38b4a` had already been reverted once for touching it out-of-fence).
  Confirmed by grep: `tests/cli.test.ts` has zero references to
  `isInvokedDirectly`/`realpath`/`junction` today.
- Routed: filed `CLI-JUNCTION-SAFE-ENTRY-TESTS` (queue head) declaring
  `tests/cli.test.ts` (+ `src/cli.ts` if `isInvokedDirectly` needs
  exporting) in `files.edit`, per the GATECONTEXT-REPOROOT-TESTS
  Derive-dimension precedent this doc already carries. Closed the
  open-questions.md entry into the closed-questions comment block.
- Spec-delta: none (`git diff 4fcb200..HEAD -- spec/` empty) — no derive
  trigger. Inbox: empty — nothing to drain. Promote: `CJS-CONTEXT-REFUSAL`
  still `blockedBy EXIT-CODE-CONTRACT`, which is still present in
  `pending-now` — no flip.

## Queue (4)

1. `CLI-JUNCTION-SAFE-ENTRY-TESTS` — open, filed this tick, `tests/cli.test.ts` (+ maybe `src/cli.ts` export).
2. `HARNESS-BLOCK-EFFECTIVE-FENCE` — open, `Prompt.ts` + `Dispatcher.ts` + docs worked-example rewrite.
3. `EXIT-CODE-CONTRACT` — open, the largest entry (mount-dead classification + loop/job-run shipped-vs-errored accounting).
4. `CJS-CONTEXT-REFUSAL` — blockedBy `EXIT-CODE-CONTRACT`.

## Open questions (0)

None live.

## Writable-paths / trunk

- `pending.json`: +1 entry (`CLI-JUNCTION-SAFE-ENTRY-TESTS`, queue head); 3 prior entries unchanged.
- `open-questions.md`: 1 question closed into the closed-block comment.
- `inbox.md`: already empty, written back byte-identical.
- Trunk: HEAD `6bd63c6` at tick start, tree clean besides untracked `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
