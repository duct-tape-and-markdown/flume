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

## 2026-05-15 — CI missing two §4/§2 publish-acceptance gates (human)

**Observation:** v0.1 queue is empty and package.json is publish-ready, but two acceptance criteria from `spec/RELEASE-v0.1.md` are not yet met. They live inside bulleted acceptance text rather than as named entries, so prior plan ticks didn't derive them. Both are pre-publish blockers under the agreed spec.

**Gap 1 — consumer-install smoke test (§4 acceptance).** Spec §4 mandates: *"A fresh consumer project's `npm install @<scope>/flume` followed by `npx flume status` works (smoke-tested in CI per §8)."* Current `.github/workflows/ci.yml` runs only `pnpm typecheck`, `pnpm test`, `pnpm build` — no consumer-install verification. The install path (`bin/flume` → `node dist/cli.js` → `tsImport` of consumer `.flume/chain.ts`) is exactly the surface most likely to break for real users and is currently untested.

**Gap 2 — `arethetypeswrong` (§2 acceptance).** Spec §2 mandates: *"`npx @arethetypeswrong/cli --pack .` reports no errors (the official lint for declaration-file shape)."* Not in CI. The DIST-DTS-EXTENSIONS fix was specifically motivated by an attw failure mode — regression-guarding it in CI is the point.

**Suggested routing:** two pending entries (or one with two file targets) against §8 Repository hygiene (`.github/workflows/ci.yml` is the §8 artifact) with `per` cites to §4 and §2 respectively. Both are small CI-step additions (~10-15 LOC each). Acceptance: CI runs a job that `npm pack`s the tarball, installs it into a tmp project with a minimal `.flume/chain.ts`, and asserts `npx flume status` exits 0; and a job that runs `npx @arethetypeswrong/cli --pack .` clean.

**Severity:** High — these are named v0.1 acceptance criteria; publishing without them ships the spec drift to the first public consumer. Blocks public publish.
