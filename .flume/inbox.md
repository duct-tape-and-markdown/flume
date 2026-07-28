# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-07-27 — CI red since 2026-07-22: pnpm 9 rejects packages-less pnpm-workspace.yaml (human, via interactive cut session)

Every CI run on main has failed since 2026-07-22, including the `cut 0.6.2` commit — all at the setup step, before any test executes. `pnpm-workspace.yaml` (added in 28eb00f to approve the esbuild postinstall, pnpm-11 `allowBuilds` shape) has no `packages` field; `.github/workflows/ci.yml` pins `pnpm/action-setup` to `version: 9` in both jobs, and pnpm 9's `pnpm store path` (run by setup-node's cache step) hard-errors `packages field missing or empty` on a workspace file without `packages`. Local pnpm 10.29.3 tolerates it, which is why nothing surfaced locally. Fix candidates: bump the action-setup pin to pnpm 10/11 (matches the pnpm-11 intent of 28eb00f), or add a `packages: ["."]` line. Severity: high — a week of CI signal lost; the 0.6.1/0.6.2 lines (incl. the windows lane and both smoke steps) have never executed in CI.

## 2026-07-27 — smoke-install fixture consumer is CJS: script fails against a good tarball (human, via interactive cut session)

`scripts/smoke-install.mjs` fails at `generated shim render notes` against the 0.6.2 tarball — but the tarball is fine. The fixture consumer is `npm init -y` with no `"type": "module"`, and chain.ts loading fails in a CJS-context consumer (tsx 4.21.0: `Cannot use import statement outside a module`; tsx 4.23.1: ERR_MODULE_NOT_FOUND with the tsImport `?namespace` query percent-encoded into the path). Verified 2026-07-27: the *published 0.6.0* fails the identical plain-consumer scenario, and the 0.6.2 tarball passes once the consumer package.json has `"type": "module"` — so this is not a 0.6.2 regression; the script has never passed as written (CI being red since before it landed means it never ran there either). Two sub-questions to route: (a) fixture fix — add `"type": "module"` to the smoke consumer (and the equivalent inline consumer in ci.yml, which likely shares the gap); (b) product question — is a CJS-context consumer repo a supported host for `.flume/chain.ts`, or should chain load detect that context and fail with a usage-shaped message instead of a tsx stack? Related hazard, lower severity: `npm pack` runs no build (only `prepublishOnly` exists), so smoke-install packs whatever stale `dist/` is on disk — a stale-dist run tests the wrong code silently; a `prepack: pnpm build` would close it.
