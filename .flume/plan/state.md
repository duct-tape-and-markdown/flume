# State

Phase: **v0.7 line derived** — `spec/RELEASE-v0.7.md` ("the truth line")
landed since the last plan tick, authored specifically to answer all
three questions this file had parked. Mode this tick: **derive** (spec-delta
was the heaviest dimension by far; drain and a light audit rode alongside).

## This tick

- `git log --grep='^plan:' -n 1` → `23509eb0` (prior plan tick, audit-only,
  clean). Five commits since: `30c5619` (chore(flume): tests-ride-the-entry
  operator ruling), `e27638d` (chore(release): cut 0.6.2), `9b07c85`
  (inbox: file CJS-context + stale-dist findings), `c11d96b` (chore(ci):
  pnpm 10 pin + smoke consumer type:module — human-directed interactive
  fix, reviewed inline this tick, matches its own commit message and the
  inbox finding it closes; no drift), `fc5b79b` (spec: author
  RELEASE-v0.7.md).
- **Audit**: none of the five commits ship a pending entry (queue was
  empty all tick), so there is no `per.section` to cross-check diffs
  against in the usual sense. `c11d96b` was read in full and is coherent
  with its own narrative — no findings. No entries filed as accepted-debt.
- **Derive** (the heavy dimension): `git diff 23509eb..HEAD -- spec/` →
  `spec/RELEASE-v0.7.md` added, 158 lines, 8 sections (no prior `plan:`
  commit had touched it). Read the file in full, then read every cited
  call site before decomposing:
  - `src/Prompt.ts:218` (`prependHarnessBlock`) + the fanout `renderPrompt`
    call site (`src/Dispatcher.ts:~1014`, `entry` already in scope) → §2 →
    **HARNESS-BLOCK-EFFECTIVE-FENCE**.
  - `src/cli.ts:846-848` (`invokedDirectly`) → §3 →
    **CLI-JUNCTION-SAFE-ENTRY**.
  - `src/Dispatcher.ts` chain-resolution-failure path (`tick()` ~L483-499,
    already sets `TickOutcome.failed`), `superviseLoop` (~L1718-1784,
    already has an `EX_TERMINAL_MISCONFIG` fail-fast precedent to mirror),
    `src/cli.ts` `tickExitCode` (~L130) and the `loop`/`job run` exit
    mapping (~L771-777) → §4 → **EXIT-CODE-CONTRACT**.
  - `loadChainModule` (`src/Dispatcher.ts:234-274`, where `tsImport`
    throws) → §5 → **CJS-CONTEXT-REFUSAL**, `blockedBy` EXIT-CODE-CONTRACT
    (its exit-2 usage-error slot must sit inside that entry's taxonomy,
    not be designed twice).
  - `GateContext` (`src/Gate.ts:34`) + its two construction sites in
    `Dispatcher.ts` (`~L797`, `~L1164`), both already holding
    `this.opts.repoRoot` in scope → §6 → **GATECONTEXT-REPOROOT**.
  - `package.json` scripts (only `prepublishOnly` exists today) → §7 →
    **PREPACK-BUILD**.
  - §8 (CHANGELOG) is not a standalone entry — per the tests-ride-the-entry
    operator ruling's spirit, its bullets ride each shipping entry's own
    `files.edit` rather than becoming a sixth follow-up.
  - §1 is purpose/scope narrative only — no entry; its explicit declines
    (structured-verdicts family, CJS-context support) are dispositions,
    not deliverables.
- **Drain**: `.flume/inbox.md` carried one entry (CJS-context product
  question + stale-dist pack hazard). Both sub-items are now answered by
  the spec that just landed — (a) routed to CJS-CONTEXT-REFUSAL (§5:
  detect-and-refuse, not support), (b) routed to PREPACK-BUILD (§7).
  Entry removed; header preserved.
- **Promote**: `pending-now` was `[]` — nothing to flip.
- **Open questions**: all three prior PARKED questions are now resolved by
  `spec/RELEASE-v0.7.md` — the CLI-junction and harness-block questions
  each got the exact fix section they were waiting on; the
  engine-ownership question's items #3/#4 shipped into this line's entries
  and items #1/#2/#5 (structured-verdicts family) were explicitly declined
  for v0.8 by the operator ruling recorded in v0.7 §1 itself — that's a
  disposition, not an open question anymore. File collapsed to a comment
  noting the closures; no live questions remain.

## Queue (6)

1. `GATECONTEXT-REPOROOT` — open, no dependencies, smallest surface.
2. `PREPACK-BUILD` — open, package.json only.
3. `CLI-JUNCTION-SAFE-ENTRY` — open, `src/cli.ts` only.
4. `HARNESS-BLOCK-EFFECTIVE-FENCE` — open, `Prompt.ts` + `Dispatcher.ts`
   (thread `assignedEntry`) + docs worked-example rewrite.
5. `EXIT-CODE-CONTRACT` — open, the largest entry (mount-dead
   classification + loop/job-run shipped-vs-errored accounting across
   `Dispatcher.ts` and `cli.ts`).
6. `CJS-CONTEXT-REFUSAL` — blockedBy EXIT-CODE-CONTRACT.

## Open questions (0)

None live. See "This tick" above for how the prior three closed.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (6 entries), `.flume/plan/state.md`,
  `.flume/plan/open-questions.md` (collapsed to a closure note), and
  `.flume/inbox.md` (one entry drained, header preserved) — all four are
  this phase's writable paths, nothing else touched.
- Trunk: HEAD `fc5b79b` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
