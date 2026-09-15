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

## Does a red CI lane open the inbox window, and what closes it? (PARKED — needs a spec amendment)

`spec/harness.md` *CI lanes as a findings source* says the inbox slice reads
the lane and files its failing titles. `spec/cli.md` *win32 is a supported
host* says a red lane "is a queue, never silence". Neither says whether a red
lane makes the slice **live**. Today `inboxWindow` is live on a pending record
or a standing build refusal (`harness/windows.ts`), both pure disk reads; a
sync subprocess in a liveness leg is already precedented (derive runs git
there), so the objection is not purity.

The two halves are coupled, which is why this is parked rather than filed.
`INBOX-SLICE-RENDERS-THE-DECLARED-CI-LANE` renders the run and lets the
slice's agent take the titles, exactly as it takes a record's content — no
title parser anywhere in the package. A liveness leg that closes on "every
failing title is already filed" needs that parser, and a generic parse of a
consumer's test-runner output is the reconstruction
`.claude/rules/engine-boundary.md`, *Told, not inferred* fences. Without a
closing condition the slice re-wakes every tick over a lane it already drained
(`spec/loop.md`, *No false signal*).

Options:

1. **Render-only** — ship as filed, no leg. A red lane is drained on the next
   inbox tick that woke for another reason, and a quiet tree hibernates over
   it. Cheapest, and the one reading the cli sentence rules out.
2. **A drained-run stamp in the plan state** — live iff the lane's latest
   completed run failed *and* its run id is past the stamp the slice last
   wrote; the slice stamps it as it stamps a cursor. Closes decidably, needs
   no parser, costs one tick per red run. The line that moves is
   `spec/harness.md` *Plan state as declared state* — it names the derive and
   sweep cursors and the continuation signal, and this is a fourth field.
3. **Title extraction** — a fourth runner operation turning a lane's log into
   failing titles, so liveness reads "some title is unfiled". Moves
   `spec/harness.md` *The runner interface*, which states three operations,
   and puts a log parser in every consumer's runner.

**Recommended: 2.** It is the shape the other two slices already use, and the
only one that closes without a parser. Derive files it the tick after the
amendment lands.
