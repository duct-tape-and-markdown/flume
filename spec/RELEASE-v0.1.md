# Flume — v0.1 Public Release Target

The human-curated ship target for the first public release. Plan derives pending entries against this; build executes them. When something here is ambiguous, the answer goes through `.flume/plan/open-questions.md` → human edit of this file → next plan tick.

This is a release-readiness doc, not a design doc. Design intent lives in `docs/INTENT.md`. Sections here enumerate *what must be true at v0.1 ship*, with acceptance criteria precise enough that plan can produce telegraphic pending entries.

Status: **READY FOR PLAN.** All v0.1 design questions are resolved. Sections below are normative for plan derivation.

## 1. Purpose & scope

v0.1 is the **first version someone other than me can install, run, and write their own chain against, with the harness's contract stable enough to depend on for a project that lives ≥3 months without rework.**

In scope:
- The four core types are stable: `Phase`, `Chain`, `Gate`, and the pending entry schema.
- The CLI is usable: `flume status / tick / loop / wake / sleep / render`.
- One agent provider (`claudeCode`) with the two decorators (`withSessionCapture`, `withTerminalRenderer`).
- Worktree fanout works for `concurrency: "fanout"` phases.
- The cascade example chain is the canonical "read this to learn the shape" artifact.

Out of scope (deferred to v0.2+):
- Multi-provider agent abstraction. Claude-only.
- Docker / SandboxProvider seam (per `docs/INTENT.md` — v1 layer).
- Session-continuity primitives. Every tick is fresh.
- Hardcoded chain templates / scaffolding command. Users write their own chain.ts.

## 2. Public API surface

The shape consumers depend on. `src/index.ts` is the canonical export list. Everything not exported from index.ts is internal and may break between minor versions.

**Must be exported and documented (one JSDoc block per export, ≥3 lines):**

- `Phase`, `Chain`, `Concurrency`, `TickContext`, `TickResult`, `WorktreeSetupContext` — phase declaration types.
- `Gate`, `GateContext`, `GatePhase`, `GateResult` — gate types.
- `shellGate`, `tscGate`, `vitestGate`, `eslintGate`, `writablePathsGate` — built-in gates.
- `PendingEntry`, `PendingList`, `parsePending`, `renderSchemaForPrompt`, `touchedPaths`, `isPickableNow`, `ParseError`, `ParseResult` — pending schema surface.
- `partitionByFileOverlap` — fanout partition helper.
- `renderPrompt` — prompt template renderer.
- `Agent`, `AgentInvocation`, `AgentResult`, `claudeCode`, `ClaudeCodeOptions`, `withSessionCapture`, `SessionCaptureOpts`, `withTerminalRenderer`, `TerminalRendererOpts` — agent seam.
- `Baton` — baton class.
- `Dispatcher`, `DispatcherOptions`, `TickOutcome`, `Logger`, `consoleLogger` — dispatcher surface.

**Ship compiled output, not raw `.ts`.** Per the official TypeScript publishing handbook: emit `.js` + `.d.ts` to `dist/`, point package.json at the compiled tree. This is the broadly-compatible choice for any consumer (pure Node, bundler, TS or JS project) and removes the runtime dependency on `tsx`. Future ship-source could be reconsidered once Node's TS support is unflagged-by-default, but that is out of scope for v0.1.

**`"exports"` map: strict, single entry.** Restrict consumer imports to `"."` only — no subpath patterns, no `./internal/*` escape hatch. If a consumer needs an internal export, they file an issue requesting promotion. Use the conditional-exports shape so the types resolver finds `.d.ts` first:

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

`"main"` and `"types"` are duplicated outside `"exports"` because npm only shows the TS-package icon when `"types"` is set at the top level, per the TypeScript handbook.

Acceptance:
- A fresh consumer project's `import { Phase } from "flume"` resolves and typechecks.
- `import { Dispatcher } from "flume/src/Dispatcher.ts"` and `import { Dispatcher } from "flume/dist/Dispatcher.js"` both fail at module resolution.
- `npx @arethetypeswrong/cli@latest --pack . --profile esm-only` reports no errors (the official lint for declaration-file shape). flume is intentionally ESM-only (`"type": "module"`, Node 22+, exports map with only an `import` condition), so the default-profile `CJSResolvesToESM` finding is the expected/correct shape, not a defect — the `esm-only` profile is the accurate bar.

## 3. CLI surface

`flume <subcommand>`. Subcommands and their contracts:

- `flume status` — print baton state (awake phases, pending entry count, last commit). Exit 0 always (status is observational).
- `flume tick` — run one phase × one tick. Exit 0 on success or hibernation; non-zero on harness error.
- `flume loop [--max N]` — run ticks until hibernation or `--max` reached (default 50). Exit 0 on hibernation.
- `flume wake <phase>` — touch `.flume/awake/<phase>`.
- `flume sleep <phase>` — remove `.flume/awake/<phase>`.
- `flume render <phase>` — print the rendered prompt for the named phase without invoking the agent. Useful for dry-run inspection.

Must have:
- `--help` on each subcommand showing usage + exit codes.
- Top-level `flume --help` listing all subcommands.
- Top-level `flume --version` printing the package version.

Acceptance: each subcommand has a one-paragraph entry in `docs/CLI.md` (new file) covering exit semantics, side effects, and one example invocation.

## 4. Distribution

**How users install flume:** `npm install <scoped-package-name>` from the public npm registry. The unscoped name `flume` is taken by an unrelated package; v0.1 publishes under a scoped name (e.g. `@<github-username>/flume`). The exact scope is a publish-time decision recorded in `CHANGELOG.md` for the v0.1 entry.

**Build step.** v0.1 introduces a `dist/` build target:
- `tsconfig.build.json` extends `tsconfig.json` but flips `noEmit: false`, sets `outDir: "./dist"`, `declaration: true`, `declarationMap: true`, `sourceMap: true`, and removes `allowImportingTsExtensions`. `tsconfig.json` (the dev/typecheck config) stays as-is.
- `package.json` `"scripts"` gains `"build": "tsc -p tsconfig.build.json"` and `"prepublishOnly": "pnpm build"`.
- `dist/` is gitignored; the npm tarball includes it.

**`bin/flume` simplifies.** Currently invokes `tsx src/cli.ts`. Post-build, it `exec node "$DIR/../dist/cli.js"`. **`tsx` remains a runtime dependency** — every consumer's `.flume/chain.ts` is a TypeScript file, and `dist/cli.js` loads it via `tsImport()` from `tsx/esm/api` (plain Node refuses `.ts` from anything under `node_modules`, even with `--experimental-strip-types`). The loader contract lives in `cli.ts`, not the bin shim, so `bin/flume` stays trivial.

**package.json must have**, at v0.1 ship:
- `"version": "0.1.0"` (flipped from `"0.0.0"`)
- `"private": false`
- `"license": "MIT"`
- `"repository": { "type": "git", "url": "git+https://github.com/<owner>/flume.git" }`
- `"homepage"` and `"bugs"` pointing at the GitHub repo and `/issues`
- `"keywords"`: at minimum `["claude", "agents", "ai", "harness", "pipeline"]`
- `"main"`, `"types"`, `"exports"` per §2
- `"files": ["dist", "bin", "README.md", "LICENSE", "CHANGELOG.md"]`

Acceptance:
- A fresh consumer project's `npm install @<scope>/flume` followed by `npx flume status` works (smoke-tested in CI per §8).
- `npm pack --dry-run` shows only the files listed in `"files"` — **enforced in CI** (a step asserting the packed file set equals the `"files"` allowlist; resolves the prior parked ambiguity in favor of a regression guard, consistent with §8's "single source of truth" stance).
- `npx @arethetypeswrong/cli --pack . --profile esm-only` is clean (see §2 — ESM-only is deliberate).

## 5. Tests

v0.1 ships with a real test suite. The current state is zero test files — that's the single largest gap. Coverage target is **representative, not exhaustive**: each load-bearing module has at least one test that would fail if the module broke in a meaningful way.

**Required test files** (one per module unless noted):

- `tests/PendingSchema.test.ts` — round-trip parse for each `gate.kind` (`open`, `blockedBy`, `parked`, `deferred`, `requiresDockerHost`); reject malformed entries; `renderSchemaForPrompt` snapshot.
- `tests/Baton.test.ts` — wake / sleep / awake flag-file roundtrip; no-op on double wake; safe on missing directory.
- `tests/partition.test.ts` — disjoint entries → one batch; overlapping entries split across batches in stable order; `maxParallel` respected.
- `tests/Agent.test.ts` — `claudeCode` outputFormat injects flags; `withSessionCapture` writes the file; `withTerminalRenderer` parses NDJSON and drops non-tool events; `timeoutMs` aborts via `AbortSignal.any`. Use a fake `Agent` for the decorators; `spawn`-mocking is fair game for `claudeCode` itself.
- `tests/Gate.test.ts` — `shellGate` success + failure paths; `writablePathsGate` accepts in-glob, rejects out-of-glob; afterCommit vs afterMerge wiring.
- `tests/Dispatcher.test.ts` — singleton tick with fake agent: commit detected, gate failure reverts, handoff wakes successor. Fanout tick: two disjoint entries → both ship, one cherry-pick conflict → that entry stays in pending, afterMerge gate fail → wave reverts.
- `tests/git.test.ts` — at minimum, a smoke test that `revParse` and `commitPaths` work on a temp repo.

Acceptance: `pnpm test` exits 0 with at least one passing test per file above. `vitestGate` becomes a meaningful gate (not a no-op against an empty suite).

## 6. Documentation

**README.md** (existing, needs revision):
- ≤200 lines.
- Sections: What it is, Posture, Quickstart (install + 5-line chain.ts + `flume tick`), The chain, Concurrency, Where state lives, Status (v0.1: stable enough for ≥3-month projects, expect minor-version breaking changes pre-1.0), Pointers (INTENT.md, examples/).

**docs/INTENT.md** (existing, no edit required): the design rationale. Linked from README. Survives v0.1 unchanged.

**docs/CLI.md** (new, per §3): one paragraph per subcommand.

**docs/CHAIN-AUTHORING.md** (new): a walkthrough of building a chain.ts from scratch, leaning on `examples/cascade-chain.ts`. Sections: declaring a Phase, writing a custom Gate, choosing concurrency, the agent seam, the prompt template format. Target length: ≤400 lines.

**JSDoc on every public export** (per §2 — ≥3 lines each). Type-only exports inherit the doc of their definition site.

Out of scope: a docs site, prose API reference (the JSDoc is the API reference; tools like `typedoc` can render it post-v0.1 if there's demand).

## 7. Examples

- `examples/cascade-chain.ts` — already exists; the canonical "read this first" artifact. v0.1 polishes it: every Phase has a JSDoc preamble, every custom gate is annotated with why it exists, the trailing comment block explains how the file plugs into a host repo's `.flume/chain.ts`.
- `examples/minimal-chain.ts` (new) — single-phase chain (no fanout, no spec separation), ≤80 lines, demonstrates the minimum viable Phase shape. Imported in the Quickstart section of README.

Acceptance: both files typecheck under `tsconfig.json`'s include globs and don't import anything that isn't in `src/index.ts`'s public surface.

## 8. Repository hygiene

- `LICENSE` — file at repo root. Use the canonical SPDX MIT text (https://spdx.org/licenses/MIT.html) with the `<year>` and `<copyright holders>` placeholders filled in. Copyright line: `Copyright (c) 2026 John Campbell`.
- `CHANGELOG.md` — file at repo root. v0.1 entry summarizes what shipped (authored by build during the round, last entry before tag).
- `.github/workflows/ci.yml` — runs `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then publish-acceptance: `attw --pack . --profile esm-only` (§2), a consumer-install smoke (§4 — `npm pack` → install the tarball into a fresh project → `flume status` / `flume render`), and a `npm pack` file-set guard asserting the packed set equals the `"files"` allowlist (§4 L107). On push and PR. Node 22. Caches pnpm store. **Acceptance: green on `main` for at least one PR before tagging v0.1.**
- `"files"` allowlist (in `package.json` per §4) — only `dist/`, `bin/`, `README.md`, `LICENSE`, `CHANGELOG.md` ship to npm. `src/`, `tests/`, `examples/`, `docs/`, `.flume/`, `.claude/`, `reference/`, `spec/` are excluded from the published tarball but remain in the git repo. No `.npmignore` (the `"files"` allowlist is the single source of truth).
- `.gitignore` — already covers `node_modules/`, `.flume/awake/`, `.flume/sessions/`, `.flume/worktrees/`. Add `dist/`.

## 9. Versioning policy

- Semantic versioning starting at 0.1.0.
- Pre-1.0: minor versions may break the public API surface (§2). Patch versions never break it.
- 1.0 ships when there's enough usage signal to commit to API stability under semver.
- Each public-API breaking change between minors lands with a CHANGELOG entry under a `### Breaking` subheading.

## 10. Non-goals for v0.1

Filed here so plan doesn't accidentally derive entries for them:

- Docker / sandbox isolation primitive. Worktrees are the only isolation surface.
- Provider abstraction beyond claudeCode. The `Agent` interface exists so v0.2+ can add codex/gemini/etc., but v0.1 ships claudeCode only.
- Session continuity, in-tick iteration, conversational agent state. Per `docs/INTENT.md`.
- A scaffolding command (`flume init`). Users hand-author chain.ts following `examples/cascade-chain.ts`.
- An MCP server, REST API, web UI. CLI only.
- Backwards-compat shims, deprecation paths, `// removed` markers. Pre-1.0 clean-slate posture per `.claude/rules/spec-plan-build.md`.

## 11. Resolved decisions

For audit. All decisions are now normative in the sections that depend on them; this log is reference only.

- **Distribution: npm publish under a scoped name.** §4. The unscoped `flume` is taken; final scope chosen at publish time.
- **License: MIT.** §8. Canonical SPDX text.
- **Ship compiled `dist/`, not raw `.ts`.** §§2, 4. Per the official TypeScript publishing handbook.
- **`"exports"` map: strict, single `"."` entry.** §2. No subpath patterns, no internal escape hatch. Promotion-by-request via issue if a consumer needs an internal symbol.
- **Test config: dedicated `vitest.config.ts`.** §5. Ecosystem convention; grep-able; extensible. Already in build's writablePaths.
- **`flume render` scope: minimal.** §3. Dry-run prompt rendering only; arg-override deferred to v0.2 unless a user asks.
