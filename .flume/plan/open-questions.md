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

## Does `flume loop --help` owe the operator `killGraceMs`? (PARKED — a UX call)

Drained from `A-SIGNALLED-LOOP-TAKES-DOWN-THE-WHOLE-TICK-TREE`'s note
(f432830). The supervisor now bounds a signalled run's wait with
`supervisorPolicy.killGraceMs` (default 5000). `src/cliHelp.ts` quotes
`abortThreshold` and no other supervisor knob, and `flume loop --help` says
nothing about the grace.

**Not derivable as filed.** `spec/cli.md` line 82 scopes `--help` to "usage
and its exit codes". `abortThreshold` is quoted only because it explains
exit 1; `killGraceMs` changes no exit code — it changes how long `Ctrl-C`
takes to return, which is operator-visible in a way `maxParallel` is not but
is not a thing the spec says help owes. Which knobs help names, and in what
words, is the call.

Options:

- **Name it under the graceful-stop text, not the exit codes.** One line:
  the release waits on the tick tree, bounded by
  `supervisorPolicy.killGraceMs` (default 5000, POSIX only). Smallest edit;
  leaves the exit-code list keyed to exit codes.
- **Widen help to the whole block.** Name all six knobs wherever each
  belongs. Consistent, and the pin is mechanical (help against the type) —
  but it makes `--help` a second copy of `docs/CHAIN-AUTHORING.md` §9, which
  `CHAIN-AUTHORING-WALKS-EVERY-SUPERVISOR-KNOB` is already fixing.
- **Name nothing.** The guide and `spec/chain.md` carry the block; help
  stays at usage and exit codes as the spec scopes it.

Recommended: the first, if a line is wanted at all. A `Ctrl-C` that appears
to hang for five seconds is the kind of thing an operator looks up in
`--help` before anywhere else; the other five knobs are not.

## Should the sweep read a citation that resolves but no longer points at the fact? (PARKED — needs a posture-page amendment)

Drained from `HARNESS-WINDOWS-IS-FIVE-MODULES`'s note (f432830). The split
left nine comment citations naming `harness/windows.ts` for facts that had
moved to the new modules. The build tick re-homed them by hand. Nothing
would have caught them: the citation scan resolves a **token** against the
tree, and `harness/windows.ts` still exists, so a pointer at the wrong file
is green.

**Not derivable as filed, and not promotable.** `.claude/rules/engineering.md`
*Narration is the ladder's bottom rung* scopes the pin to "the token, never
its meaning" — deliberately, and that limit is right: whether a file still
holds the fact a comment cites is a judgement, not a resolution. So the rung
this belongs on is the judged one, and `.claude/rules/posture-sweep.md` is
where a judged lens is declared. Plan cannot write either page.

Options:

- **Add a standing sweep lens** beside *expired narration*: a citation whose
  named file no longer holds what the citing sentence claims of it, read
  within the neighborhood the tick is already judging. Costs nothing on a
  quiet tree; the frontier already bounds it.
- **Bind it to the split instead.** A commit that moves a job between files
  re-homes the citations pointing at the old home, stated once in
  *A module is one job* as part of what a split ships. Narrower, and it
  fires exactly where the nine were created.
- **Accept it.** Stale pointers are prose drift, and prose is the bottom
  rung by design.

Recommended: the second. The nine were made by one commit shape, and naming
the obligation at that shape is cheaper to hold than a lens every sweep tick
re-reads — the finding class is created by splits, not by time.
