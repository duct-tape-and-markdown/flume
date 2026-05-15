# State

Phase: **v0.1 public-release prep — tagging gate.** Mode this tick: **audit** — the only non-empty delta dimension is the commit-delta (3 commits). No spec-delta, empty inbox, empty pending: derive/drain/promote all no-op.

- **Audit, `92e6984` (build, `DOCS-SETUPWORKTREE-PNPM`, per §6).** Faithful. All five §6 setupWorktree-acceptance clauses met: no node_modules-symlink recommendation; `pnpm install --frozen-lockfile` documented as the default (with the concrete `execFile` call inline); `enableGlobalVirtualStore` flagged experimental opt-in with the exact `pnpm-workspace.yaml` + pnpm/git-worktrees cites; strategy-agnostic `afterCommit` sanity gate recommended; file = 400 (≤400). §1 hook-table row corrected to match. Scope clean — single declared file; the extra intro/Fanout prose tightening is the ≤400-ceiling consequence the entry itself anticipated ("file is currently 401"), not creep. One trivial precision loss accepted as debt: the Fanout prose dropped "in commit order" from the merge sentence — doc stays correct, not a §6-acceptance clause, re-adding it would force a fresh cut at the 400-line ceiling. Not worth a pending entry.
- **Audit, `fb8d82b` (build, `CI-PACK-FILESET-GUARD`, per §8 + §4 L107).** Faithful. `npm pack --dry-run --json` diffed against the `files` allowlist; fails both drift directions (stray = over-inclusion, empty = under-inclusion). Positioned after `pnpm build` so `dist/` exists (npm pack does not run prepublishOnly — comment is correct); `--dry-run` writes no tarball so it is order-independent vs the real `npm pack` in consumer-smoke. npm's always-included set is covered: `package.json` handled explicitly, README/LICENSE/CHANGELOG attributable via the allowlist exact-match. No false stray. Scope: `ci.yml` only. Acceptance met locally; "green on `main` for ≥1 PR before tag" is the out-of-band §8 ship gate (workflow runs on push/PR — not plan-verifiable).
- **Audit, `6bc60ff` (`chore(flume):`).** Ship commit for both entries above; drained `pending.json` `[…]→[]`. Harness lane, faithful.
- **Derive / Drain / Promote.** No-ops: no spec changes since last plan; inbox empty; pending empty.

Queue: 0 entries. In flight: nothing.

Remaining v0.1 acceptance — all out-of-band, none plan- or build-derivable:
- **`chore(flume):` switch `.flume/chain.ts` `buildSetupWorktree`** (L84–92 still symlinks `node_modules`; L81 comment still claims "A symlink suffices") to `pnpm install --frozen-lockfile` + optional `afterCommit` sanity gate (§6/§11). This is now the *only* doc-vs-dogfood inconsistency: docs teach pnpm-install (shipped `92e6984`), the dogfood chain still symlinks. chain.ts is the `chore(flume):` lane — off build *and* plan writablePaths. Decision is made (spec normative); execution is harness lane. Not an open question (no decision to park), not a pending entry (off-allowlist) — tracked here.
- **Final scope name** — `@dtmd/flume` currently in `ci.yml` smoke + `package.json`; record in `CHANGELOG.md` at the v0.1 tag (§4, publish-time decision).
- **Land a CI-green PR on `main`** (§8 acceptance) then tag v0.1.

Open questions: 0.

Trunk: delta since last green check is `docs/` + `ci.yml` only — no `src/`/`tests/`/config change (`git diff ef31b9b..HEAD` over those paths is empty). `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests). (`ci.yml` workflow itself runs on push/PR — not plan-verifiable locally.)

Plan continues: no
