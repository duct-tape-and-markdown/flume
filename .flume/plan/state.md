# State

Phase: **v0.1 line shipped (tagged `v0.1.0/.1/.2`, published `@dtmd/flume@0.1.2`); v0.2 staged but uncommitted.** Mode this tick: **audit** — heaviest non-empty dimension is the 13-commit delta. Spec-delta exists but derive is a no-op (see below); inbox empty; pending empty.

- **Derive (spec-delta §2 `import`→`default`, committed `271db77`).** No-op. `package.json` already has `"default": "./dist/index.js"` (shipped `0a104da`); the ci.yml comment was corrected to match (`a366ea4`); §2 acceptance bullets 1–2 unchanged, bullet 3 reworded only. The spec change *documents* an already-shipped decision — nothing to file. Audit confirms conformance.
- **Audit, `0a104da` / `2d77a9b` (per §4 / §2).** Faithful. `0a104da` bin-symlink resolution + exports `default`; `2d77a9b` tsImport default-export interop in `loadChain`. Both align with §2's new paragraph (`tsImport` require-ish path needs `default`, not `import`); consumer-install smoke is the binding check (§4).
- **Audit, `a366ea4` / `2c181d7` (per §2 / §4 L110).** Faithful. attw → continue-on-error (upstream `@arethetypeswrong/cli@0.18.2` crash, unreproducible locally); a binding nodenext `.mts` consumer type-resolution gate replaces attw's lost value and exercises the `types` condition incl. `WorktreeSetupResult`. §2/§4 still satisfied — attw kept for signal, real resolution now bindingly gated.
- **Audit, `e9adb1c` / `8fbcdf1` (per §6 docs / hygiene).** Faithful. README + `docs/CHAIN-AUTHORING.md` scope placeholder `@<scope>/flume`→`@dtmd/flume`; untrack `reference/` scratch + gitignore. No tarball impact (`reference/` off `files`).
- **Audit, `fcf6a45` / `488c303` / `69eea5d` (per §8 / §8 / INTENT).** Faithful. gitignore `.env` (keep `.env.example`); CHANGELOG `[0.1.0]`; INTENT post-v0.1 dependency-aware fanout note (correctly *rejects* agent-teams stateful sessions; design-intent lane).
- **Audit, `a665ed8b` (`chore(flume):`).** Faithful, harness lane. `buildSetupWorktree` now does fresh `pnpm install` (comment cites pnpm/pnpm#9973, hardlink-from-store) + `worktreeDepsGate` sentinel-`zod` check. **Closes the stale state.md item** "switch chain.ts buildSetupWorktree" — dogfood now matches the §6 docs. (Working tree currently re-dirties `.flume/chain.ts` — uncommitted human edit, not derived from.)
- **Audit, `ab2f10f` + `25dc78b` (NO spec authority).** `feat(phase):` added `teardownWorktree` / `WorktreeSetupResult` / `setupWorktree→{extraEnv}`, exported and **published in `v0.1.2`**. Unspecced public surface (not §2/§6, not v0.2 §2–§7). → **OQ #2** (NEEDS AMENDMENT; can't backfill — no `per` cite).
- **Audit, `25dc78b` CHANGELOG `[0.1.1]` + body.** Asserts "no `v0.1.1` git tag exists"; **false** — annotated `v0.1.1 → ce73d95` (off-`main` fork commit; `v0.1.0` tag also off-`main`; only `v0.1.2`==HEAD on `main`). Ship-artifact falsehood coupled to an unresolved tag-reconciliation call. → **OQ #3**.

Queue: 0 entries. In flight: nothing. Pending stays `[]` — all three findings park (no clean `per` cite ⇒ open question, not pending, per spec-plan-build).

v0.1 status correction (prior state.md was stale): v0.1 is **shipped** — tags `v0.1.0/.1/.2` all exist, `package.json` 0.1.2, CHANGELOG entries present, scope `@dtmd/flume` resolved & recorded. The prior "remaining: switch chain.ts / pick scope / CI-green-PR-then-tag" list is done or moot (tags exist). The live concerns are now the three OQs, not v0.1 prep.

Open questions: **3** —
1. `spec/RELEASE-v0.2.md` untracked → v0.2 derive blocked until committed (PARKED; rec: commit it).
2. Unspecced published worktree-hook surface → which spec line owns it + process gap (PARKED/NEEDS AMENDMENT; rec: add to v0.2 §2).
3. `v0.1.1` tag exists vs CHANGELOG/`25dc78b` claim it doesn't (PARKED; rec: keep tags, correct CHANGELOG — build follow-up once decided).

Trunk: `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests). HEAD `25dc78b` == `v0.1.2`. (ci.yml runs on push/PR — not plan-verifiable locally.)

Plan continues: no
