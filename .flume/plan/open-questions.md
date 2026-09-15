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
- **An engine defect that also bites on posix** — `src/Prompt.ts`. `renderPrompt`
  substitutes `{{KEY}}` and *then* feeds the resulting text to `sh` via stdin
  (`substitutePlaceholders` → `evaluateInlineExec` → `runInlineExec`), so a
  substituted value lands in a shell string unquoted. `harness/prompts/*.md`
  writes `` !`cat {{PENDING_PATH}}` ``; on win32 `sh` eats the backslashes and
  the render aborts — `cat: 'C:UsersRUNNER~1AppData…': No such file` — taking
  three `harnessPrompts` cases and one `harnessChain` case with it. **The same
  defect fires on linux for any repo path containing a space**, which reduces to
  a case this suite runs today. Its fork is small but real and wants your
  ruling: does the engine shell-quote values it substitutes inside a span (it
  owns the `sh` it spawns), or does the prompt author write `cat "{{...}}"` (the
  engine cannot know a placeholder was meant as one shell word)? Ruling this one
  is independent of the win32 fork above and worth doing either way.

## `spec/harness.md` still reads as first-match-wins, but the resolver refuses a repeated heading (NEEDS AMENDMENT — directed spec edit)

Drained from `.flume/plan/notes/CITE-AMBIGUOUS-HEADING-REFUSED.md` (build tick,
`ce2ec59`). *The cite resolver* says only that "the section must be a heading in
that file at that commit". As of `ce2ec59` the package refuses a section text
the page heads more than once — sibling or nested — naming both lines. Behavior
is now stricter than the sentence that describes it, and `spec/` is yours.

Verified at this tip: no file under `spec/**` or `.claude/rules/**` heads any
text twice, so the `per` gate is green today and nothing is blocked. This is a
corpus/`src` divergence (`CLAUDE.md`, *Source of truth*), not an outage.

**The fork:**

1. **Ratify the refusal** — one clause in *The cite resolver*: the section must
   head *exactly one* section in that file at that commit. One-line edit, makes
   the sentence true, and forecloses a later derive tick reading the current
   wording as licence to relax the resolver back to first-match. Recommended.
2. **Reject it** — first-match-wins stands, and the refusal is a pending entry
   to revert. Cheap to do, but a cite naming two sections names neither, and
   build would be handed prose the entry may not have been derived against.

**Second edit, same commit if you take (1).** `.claude/rules/spec-writing.md`,
*A heading is an identifier*, currently tells the author that renaming or
splitting a heading re-homes every citing surface — advisory prose for a
property that is now mechanically refused. Under `engineering.md`, *Narration
is the ladder's bottom rung*, it shrinks to a pointer at the gate. The note
argues that shrink; worth your read, because the page's remaining claim (sweep
the citing surfaces in the same commit) is still the author's and is *not* held
by any gate — only the duplicate half is.

Both files are outside build's fence, so neither can be an entry either way.
