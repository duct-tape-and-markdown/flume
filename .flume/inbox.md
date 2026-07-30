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

## 2026-07-30 — operator rulings on the five parked questions (operator)

1. **STALE-GLOBAL-FLUME-LOOP**: repo-local leg remediated. No live stale processes remained after hibernation (`ps` verified, `loop.pid` absent); all further loop/CLI invocations in this repo go through `pnpm build && pnpm flume ...` (repo bin → freshly built local dist), never `pnpm exec flume`/PATH. The global-install decision (`npm i -g @dtmd/flume@latest` to give other bays the v0.7 §10 handshake, vs uninstall) is machine-level state — stays with John. Route: close the repo-local corruption leg; carry the global-env note wherever fits.
2. **PENDING-GATE-DOGFOOD-ADOPTION**: closed by operator commit `2e8ccf7` (pendingGate builtin wired with entryExtension + hoisted buildFence; hand-rolled gate deleted).
3. **BUILD-PARK-COMMIT-BEFORE-BAIL**: option 1 applied by operator commit (this batch) — build prompt now commits the single-file park before exiting, both for fence conflicts and writablePaths gaps.
4. **CONSUMER-SMOKE-PIN-HANDSHAKE-BREAK**: option 1 accepted — file the one-line `--no-save` entry against the existing "Consumer-install smoke" step.
5. **INTEGRATION-LANE-NEVER-RUNS-IN-CI**: option 1 accepted — file the `job.integration.test.ts` hang investigation as its own entry; CI wiring entry blockedBy it.
