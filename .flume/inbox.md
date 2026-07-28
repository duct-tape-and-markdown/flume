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

## 2026-07-27 — chain load in a CJS-context consumer: product question + stale-dist pack hazard (human, via interactive cut session)

Background (fixed same day, same session — kept here only as context for the open items): CI had been red at setup since 2026-07-22 (`pnpm/action-setup` pinned to 9 vs the packages-less `pnpm-workspace.yaml` from 28eb00f; pin bumped to 10), and both smoke consumers (`scripts/smoke-install.mjs` and the inline one in ci.yml) were CJS-context `npm init -y` fixtures that failed chain load against a provably good tarball (`"type": "module"` now set in both). Still open, to route:

- (a) Product question — is a CJS-context consumer repo (no `"type": "module"` in the repo's own package.json) a supported host for `.flume/chain.ts`? Today the chain load dies with a raw tsx stack (tsx 4.21.0: `Cannot use import statement outside a module`; tsx 4.23.1: ERR_MODULE_NOT_FOUND with the tsImport `?namespace` query percent-encoded into the path). Verified against published 0.6.0 too — longstanding, not a 0.6.2 regression. Either support the context or detect it and fail with a usage-shaped message.
- (b) Stale-dist pack hazard, lower severity — `npm pack` runs no build (only `prepublishOnly` exists), so a local `pnpm smoke:install` packs whatever `dist/` is on disk; a stale-dist run tests the wrong code silently. CI is unaffected (explicit `pnpm build` precedes both smoke steps). A `prepack: pnpm build` would close it.
