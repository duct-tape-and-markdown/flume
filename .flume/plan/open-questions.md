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

## The export-nameability scan walks source type nodes as a proxy for the emitted `.d.ts` (PARKED — architectural fork)

Drained from the build note `PROPERTY-TYPE-POSITIONS-RESOLVE-FROM-THE-EXPORTS-MAP`
(2026-09-15), which flagged a standing gap and declined to file it.

**Verified on disk this tick.** `tests/helpers/exportGraph.ts`: `fromMembers`
reports a property position only when `member.type` is present, and
`positionsOf`'s variable arm yields no position at all when a declaration
carries neither an annotation nor a function initializer. A declaration the
walk reads no position from is silently dropped from the judged set — it is
not a pass, it is a verdict never made, and `tests/exportConsumers.test.ts`
*every type a reached property position names is exported from an entry
module* stays green over it.

The member half is latent: 720 property positions across 48 `src/` and
`harness/` files, every one annotated (measured). The variable half is **live
today** — `HELP_TOP` and `HELP_JOB` (`src/cliHelp.ts`), `RUNTIME_IGNORES`
(`src/job.ts`), `EX_DATAERR`/`EX_IOERR` (`src/cli.ts`), `NAME_MAX` and
`TAG_MAX_LENGTH` (`src/PendingSchema.ts`), `PROMPT_NAMES`
(`harness/prompts.ts`), `NO_COMMIT_MODES` (`src/Prompt.ts`) are each reached
and each contribute no position. Nothing is hidden yet, because every one
infers to a literal or an array of literals. The emitted `.d.ts` does name an
inferred type, so the first `export const defaults = { chain: someChain }` or
`readonly store = new PriorAttemptStore()` puts a name in the hover text that
no `import` can carry, and the pin says nothing.

**The upstream suspect, and why this is a fork rather than an entry.** The
scan's subject is what the emitted `.d.ts` names; it reads source type nodes
instead. Every gap above is one re-implementation gap, and closing them one
at a time is chasing the tail (`.claude/rules/engineering.md`, *A seam gate
reads what the real writer wrote* — the real producer of those names is
`tsc`'s declaration emit).

1. **Read the real emit.** Run the build config's declaration emit and walk
   the `.d.ts` type references. Closes every gap class at once and deletes
   the approximation. Costs a `tsc` emit in the default lane; the scan
   already resolves `outDir`/`rootDir` and the fixture arms already build a
   real tsconfig, so the machinery is half there.
2. **Keep the node walk, declare its boundary.** Per *Loud or nothing*: the
   scan reports the reached declarations it read no position from instead of
   dropping them, and the walk's doc comment names what it cannot read. Cheap,
   honest, leaves the hole — the sanctioned degraded-but-declared path.
3. **Mandate annotations.** Refuse on any reached un-annotated declaration.
   Mechanically simplest, but it costs literal types
   (`export const EX_DATAERR: number = 65`) and is a house style rule wearing
   a pin.

**Recommended:** (1) if an emit in the default lane is affordable — it is the
only option under which the pin's title is true. Otherwise (2); (3) buys the
least for the most.
