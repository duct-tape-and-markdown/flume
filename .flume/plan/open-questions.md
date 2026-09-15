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

## The windows lane has been red for every run in the visible history, and nothing blocks on it (PARKED — scope ruling needed)

Answers the `DISPATCHER-SUITE-READS-THE-ENGINE-WORKTREE-REGISTRY` note, which
asked whether the windows lane was actually green after reading a positive
`toContain(orphan)` over a host-separator path that git could never emit.

**It is red, and has been continuously.** All 98 completed CI runs in the
current `gh run list` window — back to 2026-09-07 — concluded `failure`; zero
successes. Every run sampled (34073083098, 34250571694, 34872351316,
34952522412) splits the same way: `ci: success`, `windows: failure`. The last
completed run reports `14 failed | 32 passed (46)` test files, `46 failed |
1260 passed | 11 skipped (1317)` tests, and the note's specific site — `the
startup sweep reads the chain-declared base` — is in that FAIL list. So the
note's first branch is the true one: the lane reaches the file and reds on it.

**The spec already named this failure mode.** `spec/cli.md` *win32 is a
supported host*: "win32 is supported, and that commitment is only real while a
red Windows suite blocks a merge." It blocks nothing. The loop commits straight
to `main` and `.github/workflows/ci.yml` runs `on: push: branches: [main]` —
post-hoc, no PR, no branch protection. The condition the spec attaches the
commitment to is not met and cannot be met by the current workflow, so the
support claim has been vacuous for at least a week of ticks.

**The fork, which is yours:**

1. **win32 stays supported** — then this is a program of entries, and the loop
   needs a way to *read* the lane. Nothing on this host reproduces a win32
   failure, so by `.claude/rules/engineering.md` *A fix ships the test that
   would have caught it*, every one of these fixes is a guess until its repro
   reduces to a case this suite runs. Most of them don't reduce.
2. **win32 is downgraded** — the lane goes `continue-on-error` (or out), and the
   `spec/cli.md` section is rewritten to claim only what holds. Cheap, honest,
   and reversible.

Ruling either way unblocks derivation: the section above is a clean `per` cite.

**Failure families in the last completed run**, so the answering session need
not re-derive them:

- **Fault injection that is a no-op on win32** (the largest family — `job`,
  `cli`, `cliHelp`, `cliJobVerbs`, `friction`, `priorAttempts`, `Baton`,
  `Dispatcher`): every test named "unreadable" / "non-ENOENT" / EACCES. `chmod`
  does not deny a directory on Windows, so the injected failure never happens
  and the refusal under test resolves instead of rejecting. Test-harness
  defects, not engine defects — but they mean the whole *loud-or-nothing*
  posture is unverified on win32.
- **8.3 short names vs. long names** (`worktrees.test.ts:146/355/383`):
  `expected [...] to include 'C:\Users\RUNNER~1\AppData\Local\Temp\…'`. The
  suite composes off `tmpdir()` (short form); git reports the resolved long
  form (`runneradmin`). A separator fold alone does not close this — it wants a
  `realpath` on both sides.
- **Symlink creation** (`bin.test.ts`, both symlink-walk cases): unprivileged
  Windows refuses `symlink()` without Developer Mode.
- **The win32 path-limit tests fail on win32** (`JOB-EXISTSSYNC-WIN32-PATH-TOTAL-LIMIT`,
  `DISPATCHER-NAMESPACEDJOIN-WIN32-PATH-TOTAL-LIMIT`). These exist only for this
  platform and have never passed on it.
- **A span substituting an unquoted path** — **ruled at `808aa09`**, and no
  longer part of this question: `spec/prompt.md` *The render pipeline* says a
  value substituted into a span's command is text in a shell string and the
  author quotes it. The package's prompts take the quotes; derive files them.
  Named here only so the failure tally above stays honest — three
  `harnessPrompts` cases and one `harnessChain` case belong to this family.

## A deleted symbol leaves its doc-comment citations standing, and the ladder's carve-out excludes the prose that broke (PARKED — scope ruling needed)

Drained from `.flume/plan/notes/UNEARNED-EXPORTS-NARROWED.md` (build tick,
`bbf7091`). That wave deleted three dead helpers from `src/git.ts`
(`softReset`, `commitsSince`, `hardResetTo`). Three surviving comments cited
them by name — `resetKeepTo`'s and `softResetTo`'s doc blocks in `src/git.ts`,
and the whole-wave-revert comment in `src/Dispatcher.ts`. The build agent
repaired all three by hand. `UNEARNED-EXPORT-PIN` will catch the export; it
sees nothing that cites a name the tree no longer declares.

**The check is decidable, and measured this tick.** Backticked
camelCase/PascalCase tokens in `src/` + `harness/` comments, read against the
identifier text those two trees declare: **1080 subjects, 0 misses at
`1226c5a`**. Green today, non-vacuous by a wide margin, no heuristic in the
verdict — a token either appears in the source text or it does not.

**The scope is the problem.** None of the three broken comments is shipped
hover text: the two `git.ts` helpers ride no `exports`-map entry (`FlumeApi.git`
exposes only `showNameOnly`, `readFileAtRef`, `statusRecords`,
`readWorktreeRegistry`), and the `Dispatcher.ts` block is an implementation
comment. `.claude/rules/engineering.md` *Narration is the ladder's bottom rung*
closes with "The one carve-out is prose that compiles into the package's public
types… Prose the package never ships stays with its authors." At that scope the
pin catches **zero of the three** and is decorative, which is why this is parked
instead of filed — the entry that would have caught the defect cannot carry a
cite that licenses its scope.

**The fork:**

1. **The carve-out admits it.** The failure mode that bullet names is "a suite
   that reads prose *against prose*"; this reads prose against the program's
   symbol table, the same footing as the existing `abortThreshold` pin reading
   a doc block against the real constant (`tests/docComments.test.ts`). Costs
   one rule sentence and one test. Known leak: an author can evade it by
   dropping the backticks — the value is catching *deletions*, not policing
   authors.
2. **Hold the line.** Internal comments stay their authors'; this closes as
   debt and stale citations are found when someone next reads them.
3. **Sweep instead of suite.** No pin; a symbol-deletion delta beside the
   retired-claim delta in `.claude/rules/posture-sweep.md` *The frontier is
   decidable; the neighborhood is judged*, so a rotation reads it rather than
   every run. Cheaper on the rule, but it puts a mechanical verdict on a
   judgment rung — the ladder argues against it.

**Recommended: (1)**, falling back to (3) if the carve-out is meant as a closed
set. Either branch is a `.claude/rules/**` edit, which is yours; the moment the
sentence moves, the entry is a one-file pin.

**One limit on the demonstration**, so the answering session does not look for
a red that is not there: neither `bbf7091^` nor the tip reds, because the
deletion and the hand-repair shipped in the same commit. The pin's red is the
deletion that *is not* hand-repaired, so the entry's `tests[]` line would be
the scanner's own flagging case and the tree property would be a `pins[]` line.
