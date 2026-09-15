# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## The release publish is hand-run, and `spec/cli.md` ratifies that (PARKED — needs a spec amendment)

Drained from the inbox (2026-09-08, human via flume-main). 0.14.0's publish
stalled a day on a dead token: CLAUDE.md named a key `.env` did not hold, the
key it did hold had expired in May, and `pnpm publish` ignored the env-var auth
form and read `~/.npmrc`, surfacing as a 404 on the PUT. Tag and commit were
already pushed, so the registry lagged the tag by a day.

**Not derivable as filed.** `spec/cli.md` *Versioning policy* currently states
"The version bump and `npm publish` are human-performed at cut time." A tagged
CI publish contradicts that line, so the line moves first.

Shape the finding proposes, carried here so the answering session need not
re-derive it — temper's `.github/workflows/release.yml`: `on: push: tags:
["v*"]`, publish with `secrets.NPM_TOKEN` through `setup-node`'s
`registry-url`, **idempotent** (skip when `npm view <pkg>@<version>` already
resolves), and a post-publish smoke that installs the published tarball from
the registry and runs the shim — `scripts/smoke-install.mjs` already does this
against a local pack; the job points it at the registry.

Two things are the operator's regardless of the ruling: setting the repo
secret, and whether release automation is wanted at all for a package whose
cut is deliberately hand-curated (changelog mining, `smoke:install`).
`.github/**` is already inside build's fence, so the work ships the moment the
spec line moves.

## `.flume/PROTOCOL.md` counts the plan state's typed fields, and no phase can recount them (PARKED — operator edit)

Drained from a build note (`PLAN-STATE-CARRIES-THE-DRAINED-RUN-STAMP`).
`.flume/PROTOCOL.md:70` says the plan state is "three typed fields"; the
`drainedRuns` stamp landed and made it four. `harness/prompts/plan-discipline.md`
and `harness/planState.ts`'s schema already say four.

`.flume/PROTOCOL.md` is outside build's fence (`.flume/declaration.ts` declares
no `.flume/**` path) and outside every plan slice's writable paths, so no tick
can correct it. It is also the file `CLAUDE.md` sends every agent to for chain
conventions, so the stale count reads as current to whoever opens it.

**The fix worth making is not `three` → `four`.** The count restates a shape
`harness/planState.ts` owns mechanically and `plan-discipline.md` spells out —
a second copy kept in sync by discipline (`.claude/rules/engineering.md`,
*Derived state is computed, never restated beside its source*), which has now
gone stale on its first field change.

Options:

- **Point, don't count** (recommended) — replace "three typed fields" with a
  pointer to the discipline page's field list. The next field change then
  touches one artifact instead of two.
- **Recount now** — one-word edit, and the same defect stands for the next
  field.
- **Widen a fence to reach `.flume/PROTOCOL.md`** — rejected on its face:
  PROTOCOL.md is where the operator states conventions *to* the phases. A
  phase that edits it grades its own homework.
