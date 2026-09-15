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

## Does the citation carve-out reach a `describe`/`it` title? (PARKED — needs a rule-page amendment)

Drained from `TESTS-COMMENTS-ARE-CITATIONS-THE-SCAN-RESOLVES` (879e877). The
comment-citation scan resolves `src/`, `harness/` and `tests/` **comments**.
A `describe`/`it` title is a string literal, not trivia, so ~14 titles citing
a bare rule page (`engineering.md` ×8, `engine-boundary.md` ×4,
`platform-facts.md` ×2) are unjudged: renaming a rule page leaves every one
of them standing while the comments beside them red.

**Not derivable as filed.** `.claude/rules/engineering.md` *Narration is the
ladder's bottom rung* scopes the carve-out to "a reference in a `src/`,
`harness/`, or `tests/` comment". Widening the scan contradicts that cite
rather than deriving from it, so the phrase moves first.

**The asymmetry the answering session should not re-derive.** Only the
`*.md` arm would bite. A title is a string literal, and a string literal is
itself a resolution arm (`tests/helpers/commentCitations.ts`, the tokens
loop) — so a backticked identifier inside a title resolves *itself*, exactly
the decorative-override failure `EXTERNAL_VOCABULARY` was moved to a `.json`
to escape. The `*.md` filename arm resolves against the working tree, not
the token set, so it is the one arm a title cannot answer for.

Options:

- **Widen the phrase to "a comment or a test title", `*.md` arm only.** ~14
  titles get rewritten to their directory-qualified spelling; the identifier
  arm is declared out at the site with the self-resolution reason above.
- **Widen to comment *and* title, both arms.** Needs the literal arm
  narrowed first, which the record measured: narrowing it to `src/`+`harness/`
  costs ~39 fixture citations, each then excused by name — worse.
- **Leave the carve-out at comments.** A title's cite stays an author's
  claim, and page renames are caught by the comment beside the title, which
  the suite already holds.

Recommended: the first. It is the whole finding at the one arm that can
carry it, and it leaves the literal arm's declared divergence untouched.
