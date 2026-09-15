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

## 38 unbackticked `*.md` page names in `src/`/`harness/` comments sit outside the citation carve-out (PARKED — needs a rules-page amendment)

Drained from the `CITATION-BARE-ENGINEERING-MD-CITES-SPELL-THEIR-PATH` note.
That entry closed four citations spelled `` `engineering.md` `` — backticked,
but basename-only, so the path arm could not answer them. The note reports the
unbackticked half of the same class, re-verified on the tree this tick: 38
page names written with no backticks at all — 20 `engineering.md`, 11
`engine-boundary.md`, 2 each `worktrees.md`, `pending.md`, `loop.md`, 1
`platform-facts.md`. The shape is `(engineering.md "Loud or nothing")`:
`src/Dispatcher.ts:1440`, `:3358`, `:4137`; `src/Gate.ts:123`, `:126`;
`src/git.ts:364`, `:721`; and 31 more (`grep -rnE
'[^`/A-Za-z-][a-z][a-z-]*\.md' src/ harness/`).

Each is the defect that entry closed — a page named by a spelling nothing
resolves — but the scan's subject rule reads backticked spans only, so all 38
are invisible to it. Renaming a rules page reds nothing.

**Why this is not plan's call.** The note hands the subject rule to plan, but
widening it means amending the carve-out, and the carve-out's own page fences
that off. `.claude/rules/engineering.md` *Narration is the ladder's bottom
rung* scopes the exception to "a backticked identifier … a reference, not a
sentence", and the paragraph above it rules: "A check on how the harness's own
prose is written is harness governance, which this page does not administer."
A rule that an `*.md` basename must be backticked and repo-relative is exactly
a check on how prose is written. Plan cannot write `.claude/rules/**` either.

**The fork, which is yours:**

1. **Widen the carve-out.** Amend the section to admit an unbackticked `*.md`
   basename as a reference on the same terms — the token, never its meaning.
   Then one entry spells all 38 as backticked repo-relative paths and the
   existing path arm judges them, with no new mechanism. The cost is that the
   carve-out now reaches a span prose did not mark, which is the line the
   paragraph above it draws.
2. **Rule the spelling, not the resolution.** Leave the carve-out alone and
   add a separate, narrower claim: a `*.md` basename in a `src/`/`harness/`
   comment is written backticked and repo-relative. Same 38-site fix, but the
   fence is a prose-shape rule with a named home — which the page says it does
   not administer, so it needs one (a new section, or a line in
   `.flume/PROTOCOL.md`).
3. **Rule them prose.** A page name inside a sentence is not a citation, and
   38 comments may name a page by basename. Cheapest; accepts that a rules-page
   rename leaves 38 stale references standing green.

Recommendation: **1**. The 38 sites are references by every reading — each sits
in a `(page, "Section")` cite, never in a sentence — and it is the only option
that adds no mechanism and no second home. The paragraph it strains against is
about reading prose *for what it says*; resolving `engineering.md` to a file
still reads the token alone.

A separate, cheaper defect from the same note is already queued as
`CITATION-SCAN-JUDGES-A-WRAPPED-BACKTICK-SPAN` and needs no ruling: two cites
*are* backticked and repo-relative but wrap across a line, and the span reader
refuses a newline.
