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

## The POSIX lane is undeclared, so its reds reach no tick (PARKED — needs an operator edit to `.flume/declaration.ts`)

Drained from `.flume/plan/notes/FORGE-STUB-ANSWERS-BEFORE-THE-HOSTS-OWN-CLI.md`
(2026-09-15, build tick). `plantForge` now drops every PATH directory holding a
`gh` of its own, which on `ubuntu-latest` takes `/usr/bin` and git with it, so
the fixture links the host's git back in. The first real exercise of that link
is a POSIX lane run — and the build tick had no way to ask for one, so it wrote
a record asking a human to read it.

**Not derivable as filed.** `.flume/**` sits outside build's fence
(`fence.build` in `.flume/declaration.ts`) and outside every plan slice's, so
no autonomous tick can declare a lane. The declaration names one:
`ci: [{ name: "windows", workflow: "ci.yml", job: "windows" }]`.

**The gap is not hypothetical.** The `ci` job failed on runs 35014206480 and
35015953021 and nothing in the loop saw either. Both failed the same step,
`pnpm test:integration`, on one title:

> claim file (and loop.pid) are gone after SIGTERM on POSIX; on win32
> (TerminateProcess, no handler runs) both survive and the claim is
> stale-reclaimable — the amended tip-claim outcome

`tests/tip-claim.integration.test.ts` is in the lane `vitest.config.ts`
excludes, so no local `pnpm test` and no build judge reaches it either. The
POSIX lane is the only reader this repo has for the integration suite.

**Shape, carried so the answering session need not re-derive it.** One line
beside the windows entry: `{ name: "posix", workflow: "ci.yml", job: "ci" }`.
`spec/harness.md`, *CI lanes as a findings source*, already makes `ci` a list
and `drainedRuns` a per-lane map, and `spec/cli.md`, *win32 is a supported
host*, describes the POSIX lane as running beside the windows one — so the
mechanism is there and only the declaration is missing.

**The fork is cost, not shape.** The `ci` job carries the publish-acceptance
steps and the integration lane, so its log is the larger of the two, and two
red lanes drain in one tick against one line budget. A second wrinkle: an entry
fixing an integration-lane red can carry no `tests[]` line, because the judge's
running lane never reaches that file — such an entry ships on `acceptance` and
the lane's next run alone.

Options:

1. Declare it, and accept two lanes' logs in a drain tick.
2. Declare it, and retire the windows lane once win32 settles — one lane at a
   time, whichever host is currently fragile.
3. Leave it undeclared, and keep POSIX regressions the interactive session's to
   notice. The integration suite then has no automated reader at all.
