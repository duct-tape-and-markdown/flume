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

## Two verification lenses no page names (NEEDS AMENDMENT)

Drained from two build notes. Each is a failure shape a shipped fix found the
hard way; neither has a home, and the pages that would hold them —
`.claude/rules/posture-sweep.md` *A violation counts only when verified on disk
this tick* for a standing lens, `.claude/rules/engineering.md` *Narration is the
ladder's bottom rung* for what a promoting commit owes — are the human's.

**Lens 1 — a negative assertion over a whole rendered prompt.** The
`<prior-attempt>` block quotes stacks carrying the tick's worktree path, and
that path is the entry tag, so `not.toContain` over a whole prompt turns on
where the tick happened to run. A-NEGATIVE-ASSERTION-READS-ITS-OWN-BLOCK
rescoped four such subjects; the audit found three more in the same file that
are green by accident (underscored stream keys, long authored prose, unique
markers).

**Lens 2 — a shrink that orphans a sibling's cite.** Shrinking a doc comment to
a pointer can remove the only citation of a fact a *different* site in the file
was leaning on. PRIOR-ATTEMPT-PROSE-CITES-THE-PAGE-THAT-OWNS-ITS-FACTS hit it:
retargeting `refusalOf`'s doc would have left a case restating *chmod denies
nothing on win32* uncited, so the cite moved down to the case that decides on
it. The lens is "a shrink is not complete until the facts the removed prose was
covering for are re-homed."

Options:

- **(a)** Lens 1 as a standing sweep lens, lens 2 as a bullet on the ladder
  section — it is about what a promoting commit owes, not about existing code.
- **(b)** Lens 1 only. It is the one with a measured red behind it.
- **(c)** Neither. Both are judgment a build tick already exercises, and a page
  that lists every remembered shape stops being read.
- **(d)** Lens 1 a rung up, as a scan rather than prose.

Recommended: **(a)**. Against **(d)**: "the subject is a whole rendered prompt"
is not decidable from syntax — the scan would have to guess which variable
holds a whole prompt, and a guessing scan files findings nobody can close.
