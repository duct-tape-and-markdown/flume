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

## The spawn budget's vocabulary stops at `node`, and the lane now holds three postures (PARKED — needs a spec ruling)

Raised by the windows lane, run 35032751113. `tests/harnessGates.test.ts`'s
first case timed out at vitest's 5s default; it spawns nothing but `git`.

`SPAWN_BUDGET_MS` (`tests/helpers/subprocess.ts`) is "the one number every
spawning site in the default lane declares", and `tests/subprocessHelper.test.ts`
holds a scan proving it. But the scan's `NODE_COMMANDS` vocabulary
(`tests/helpers/spawnBudget.ts`) excludes `git` **deliberately and with a
cite** — `spec/worktrees.md`, *The default test lane must stay fast*: "measured
across ~190 default-lane tests it is fast and has never flaked". That
measurement is POSIX's. The windows lane has now produced the counterexample,
and the sentence is yours to move.

What the exclusion has left in the lane — three postures, none of them judged:

1. **The shared constant.** Node-spawning sites import `SPAWN_BUDGET_MS`. The
   scan holds these.
2. **A restated literal.** `tests/Dispatcher.test.ts` spells `20_000` at 202
   sites and `tests/worktrees.test.ts` at 7 more. The scan's own
   `declaredBudget` calls a literal *not* a declared budget — "the number
   restated per case, which is what left six different timeouts on this lane's
   spawning cases before the budget had a home" — but it never looks at these,
   because they spawn git rather than node.
3. **Nothing.** `harnessGates` (16 cases), `harnessWindows` (21),
   `chain` (12) inherit the 5s default. This is the one that red the lane, and
   `A-GIT-SPAWNING-SUITE-DECLARES-ITS-BUDGET` clears it — under any answer
   below, those cases want the shared number.

The fork is what the scan should judge, and at what granularity:

- **(a) Widen `NODE_COMMANDS` to `git`, keep per-case declaration.** Correct by
  the budget's own premise and prevents the fourth posture. Cost: every
  git-reaching case in the lane must name the constant — the 209 literals above
  plus most of `Dispatcher`, `Gate`, `builtinGates`, `job`, `git`,
  `priorAttempts`, `examples`. Order 1,000 sites, mechanical but enormous, and
  it makes `tests/Dispatcher.test.ts` collide with several queued entries.
- **(b) Widen the vocabulary, move the declaration to file scope.** One
  `vi.setConfig({ testTimeout: SPAWN_BUDGET_MS })` per spawning file, ~15 lines
  total, and the scan judges files instead of cases. Needs `spec/worktrees.md`'s
  "declares a **per-case** budget rather than inheriting the runner's default"
  to become a per-file phrase. **Recommended**: it holds the same property at
  1.5% of the diff, and the per-case form buys nothing here — no case wants a
  different ceiling from its file.
- **(c) Leave the scan node-only.** Git-spawning suites stay on convention;
  posture 2 stays as accepted debt. Cheapest today, and the next suite written
  without a budget reds a lane months later — which is the trade `A-GIT-SPAWNING-SUITE-DECLARES-ITS-BUDGET`
  is taking on its own, deliberately, until this is ruled.

Not proposed here: raising the lane's `testTimeout` in `vitest.config.ts`. It
would give a genuinely hung *unit* case 120s instead of 5s, which is what the
per-site idiom exists to avoid.
