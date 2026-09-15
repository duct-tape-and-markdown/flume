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

## 329 dead release-corpus cites in `tests/` are pure shape, and posture-sweep *Routing* forbids the entry that would cut them (PARKED — routing-clause ruling needed)

Drained from the inbox (2026-09-15, interactive session), filed after five
consecutive sweep ticks each accepted the same debt from inside its own
neighborhood. Every measurement in the record re-verified against this tree.

**The finding.** `spec/RELEASE-v0.*.md` was retired at `b622b15` ("flatten the
release corpus into seven topic files"). 329 cites into it survive across 18
files in `tests/` — 145 name a release line (`RELEASE-v0.N`, `v0.N §M`), 184
are a bare `§M` that resolved only through that corpus. 101 sit inside a
`describe`/`it`/`test` title. Four `src/` doc comments (`PendingSchema.ts:87`,
`paths.ts:253`, `Prompt.ts:478`, `:731`) point at a test case *by* its
§-bearing title, so they move in the same commit as any title rewrite. One more
in `scripts/smoke-install.mjs:191`. `src/`, `harness/`, `examples/`, `README.md`
are otherwise clean; `docs/` hits are historical material and out of scope.

**Why this is parked rather than filed.** The record recommends one bulk
entry. I can't write it. `.claude/rules/posture-sweep.md` *Routing* sets the
filing bar at correctness-adjacency and says pure shape — "duplication,
narration drift, style" — goes to "an **accepted-debt line** in the plan commit
body, **never an entry**." The record concedes the finding is not
correctness-adjacent: no behavior sits behind any cite, and the titles still
assert what their bodies do. Filing it anyway would be plan overriding a
"never" in a human-authored rule page, through the inbox, to reach a conclusion
the Sweep dimension's own routing bar refuses. That's the amendment's call, not
mine.

**The record's argument, which is the live part.** *Routing* justifies the debt
line with an economics clause: "a later rotation re-noting the same debt is
cheaper than a queue that grows faster than build drains it." The record
measures that clause as inverted — the queue is empty, recent entries ship
within the tick they're picked, and the re-note is not one line but a full
re-derivation in each sweep tick's body, which is the token tax
`engineering.md` *Derived state is computed, never restated beside its source*
names, paid by plan instead of by a file.

**Two corrections to the record's sizing**, so the ruling isn't made on
inflated numbers. It claims "35 frontier modules remain, 18 of them are these
files." Derived against the live state this tick: **23** remain, and only
**8** of the 18 cite-carrying files are still uncovered (`Dispatcher`, `cli`,
`cliJobResolution`, `cliJobVerbs`, `job.integration`,
`loop-process-boundary.integration`, `examples.integration`,
`tip-claim.integration` — 240 of the 329 cites). The other 10 are already
`covered` and settled for this rotation; posture-sweep *The frontier is
decidable* forbids re-sweeping them. So the near-term re-note cost is 8 ticks,
not 18. The record's real point survives the correction: the rotation is open
under a **phrase delta** (both posture pages moved past the stamp), which
redraws the whole domain, so all 18 return on the next phrase delta — and this
repo generates those often.

**The fork:**

1. **Amend *Routing*** to let a shape finding become an entry once it is
   measured above some threshold of re-derivation cost — then this ships as
   the record's option 1: one bulk entry, `files` naming the 18 test files plus
   the four `src/` doc comments and `smoke-install.mjs`, no `tests[]` and no
   `pins[]` (it claims no property), scheduled into a solo wave that the
   partitioner already isolates by `files`. tsc and the suite gate it like any
   ship. The risk is that "measured cost" is a bar every future shape finding
   will argue it clears.
2. **Hold the line** — shape stays out of the queue unconditionally, and this
   cut waits for a human to run it by hand outside the loop (it is one
   scripted rewrite: drop the cite, keep the sentence —
   `"ensureRuntimeIgnores — §5a-3 create-or-merge"` →
   `"ensureRuntimeIgnores — create-or-merge"`). Cheapest, and it keeps the
   engine/queue boundary crisp.
3. **Neither** — keep accepting the debt, and accept the re-note on the 8
   remaining modules and on every module after the next phrase delta.

Whichever way it goes, the form to cut is the numbered one — `RELEASE-v0.N`,
`v0.N §M`, `§M`. A cite by heading text into `spec/*.md` or a rule page is the
live form and stays.
