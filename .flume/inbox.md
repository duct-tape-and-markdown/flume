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

## 2026-07-23 — static-.flume dogfood: shared-chain jobs (human, via centercode-platform jobs bay)

Context: centercode-platform ships a STATIC `.flume/` layer (shared `chain.ts`, shared `prompts/`, static README); jobs are born as brief + plan skeleton only. Built against 0.5.0; three runtime gaps, each verified against runtime source and empirically in a scratch repo (real `job new` + `--job render plan`). Evidence: centercode-platform `pr-571` @ 1b1e5aa2cd (`.flume/README.md` "Why a shim"). Cites below re-verified in this repo's source at filing time.

1. **No shared-chain resolution under `--job`.** `resolveStateDirs` (src/cli.ts:94-119) retargets FLUME_DIR and FLUME_CONFIG_DIR to `.flume/jobs/<name>`; `job run` loads chain.ts from configDir (src/job.ts:286-288); explicit FLUME_CONFIG_DIR alongside `--job` is a usage error (src/cli.ts:99-106, exit 2). A repo cannot point jobs at one resident chain — every job carries a one-line shim (`export { default } from "../../chain.ts"`) seeded via job-template. Ask: let a job resolve a repo-level chain (config key or verb flag), erasing the shim and the vestigial job-template.

2. **Template-less `job new` seeds nothing usable** — empty dir + warning (src/job.ts:189-193). With shared elements static in the repo, `job new` should birth the job-specific skeleton (brief.md stub, plan/*, inbox.md, friction.md, .gitignore) natively, no `--template` required.

3. **`Phase.promptPath` resolves against configDir, not the chain file's location** (src/cli.ts:792, src/Dispatcher.ts:508, src/Dispatcher.ts:934). A shared chain must compute prompt paths dynamically (import.meta.url gymnastics) to find its sibling `prompts/` from any job depth. Ask: resolve promptPath relative to the chain file (or support a chain-dir token).

Triage framing (from the filer): asks 1 and 3 are one design decision seen from two files — "a chain is a repo-resident artifact that knows its own location" — and likely collapse into one spec section, with ask 2 as the verb-behavior companion. Routed that way, the whole vestige (job-template, the shim, the dynamic path computation) deletes in one release. Side observation, not an ask: editor LSPs flag the shim's `../../chain.ts` import as unresolvable pre-seed; native shared-chain resolution dissolves that too.

Note for routing: no `spec/RELEASE-v0.6.md` exists yet — these are v0.6 spec asks, so absent a spec section to cite they park as open questions for the human to spec.
