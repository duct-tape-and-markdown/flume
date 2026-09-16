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

## A default-lane case may need a ceiling above the lane's one budget (PARKED — needs a spec ruling)

Drained from a build note (`THE-SPAWN-BUDGET-IS-DECLARED-PER-FILE`, 2026-09-15).
The budget moved to file scope, so a registrar's own timeout argument is now
unjudged. Most of them narrow — 243 literals at or under the 120 000 their file
declares — and `A-SPAWNING-SITE-TAKES-THE-FILES-BUDGET` files that direction.
Seven do not: `tests/harnessRunner.test.ts` carries `180_000` ×5 and `240_000`
×2 on cases that drive the real vitest runner over real gate checkouts, twice
per case (merged tree, then base). Those cases plausibly need more than the
lane's number.

`spec/worktrees.md`, *The default test lane must stay fast*, says the file
"declares the lane's **one** spawn budget at file scope". One number, lane-wide.
The suite ratified that reading mechanically: `tests/subprocessHelper.test.ts`
asserts `harnessBudgets().size === 1`. So there is today no sanctioned spelling
for "this file's worst case is legitimately longer", and the seven literals sit
outside every rule the page states.

Three dispositions, none derivable from the page as written:

1. **A second exported constant** (`RUNNER_BUDGET_MS`) that `harnessRunner.ts`
   declares at file scope instead. Cheapest, and the scan already reads a *map*
   of exported budgets — but it breaks the `size === 1` pin, and "one home for
   the lane's number" becomes "one home per cost class", which the page would
   have to say.
2. **Move those cases to the integration lane.** Consistent with the page's
   stated triggers by cost class (a real vitest run over real worktrees is the
   same shape as spawning `flume tick` to drive engine behavior) — but the page
   also says the trigger is the measured cost drivers, "never a spawn count",
   and a *ceiling* is not a cost: these cases may finish in seconds.
3. **Raise `SPAWN_BUDGET_MS` to the worst case** (240 000) for every file. One
   number preserved, at the price of every other spawning file losing a ceiling
   it was actually sized for.

Recommended: (1), with the page stating the condition — a file whose worst case
exceeds the lane's budget names a second declared constant rather than a number
of its own — and the `size === 1` pin becoming "every budget a file names is
one the harness module exports". It keeps the property that matters (no number
restated at a site) without pretending a 240 s worst case is a 120 s one.
Whichever way it lands, the ruling is `spec/worktrees.md`'s to state; until then
the seven literals stay and are cited at their site as a declared divergence.
