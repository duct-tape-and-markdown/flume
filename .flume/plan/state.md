# State

Phase: **v0.1 public-release prep — tagging gate.** Mode this tick: **derive** — heaviest delta dimension is the spec-delta (§2/§4 attw, §4 L107, §6 setupWorktree, §8 enumeration, §11). Drain (one inbox finding) and audit (chore `285c8b7` + two human spec commits) are lighter; no `blockedBy` to promote.

- **Derived 2 entries from the spec-delta.** `DOCS-SETUPWORKTREE-PNPM` (§6 new acceptance — CHAIN-AUTHORING.md must teach `pnpm install --frozen-lockfile` default, not the node_modules symlink). `CI-PACK-FILESET-GUARD` (§8 L155 + §4 L107 — pack file-set guard, now CI-enforced). Both `open`, both in build's writablePaths (`docs/**`, `.github/**`), independent.
- **Inbox drained** — runner-review node_modules-symlink finding. The human resolved it in spec (`82a2dac` §6/§11): default = pnpm-install, global-virtual-store = experimental opt-in. Routed: doc surface → `DOCS-SETUPWORKTREE-PNPM`; chain.ts `buildSetupWorktree` switch + recommended afterCommit sanity gate → out-of-band harness/chore (off build *and* plan writablePaths — chain.ts is `chore(flume):` lane); template surface (finding item d) → accepted debt, scaffolding/templates are explicit v0.1 non-goals (§1 L24, §10 L173); the `reference/` template is an external runner dump, not a flume artifact. Inbox now empty.
- **Audit, chore `285c8b7` (scope rename `@dtmd/flume` + attw `--profile esm-only` in ci.yml).** Faithful to §4 (scope = publish-time decision) and §2/§4 L64/L108. No stale `@jwcjwc12` reference survives in src/docs/README/ci (only this state.md, re-derived this tick). attw esm-only already live in ci.yml:40 — no derivable work, audit-clean. Spec commits `335b026`/`82a2dac` are the human's lane (resolve the two parked questions); verified internally consistent.
- **Both open questions closed** — resolved by the human spec commits, not by plan: §8-enumeration (NEEDS AMENDMENT) → `335b026` folded publish-acceptance into §8 L155; §4 L107 (PARKED) → `335b026` made it "**enforced in CI**" (option A). open-questions.md is now empty.

Queue: 2 entries, both pickable (`open`). Head: `DOCS-SETUPWORKTREE-PNPM` (higher-severity surface — flume actively mis-teaches the broken pattern; the finding was High).

In flight: nothing. Remaining v0.1 acceptance is out-of-band human/harness work:
- `chore(flume):` switch `.flume/chain.ts buildSetupWorktree` to `pnpm install --frozen-lockfile` + optional afterCommit sanity gate (§6/§11 — decision made; execution is harness lane, not plan/build).
- Choose the final scope name (now `@dtmd/flume`; record in CHANGELOG at the v0.1 tag, per §4).
- Land a CI-green PR on `main` (§8 acceptance) and tag v0.1.

Open questions: 0.

Trunk: delta is CI/package.json/spec only (no `src/`/`tests/` change since last green check) — `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests). Still green. (`ci.yml` workflow itself runs on push/PR — not plan-verifiable locally.)

Plan continues: no
