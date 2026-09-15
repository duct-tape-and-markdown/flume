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

## A `tests/` comment may cite a rule page, and nothing loads it or resolves it (PARKED — rule edit)

Drained from a build note (`EXPORT-GRAPH-COMMENT-POINTS-AT-THE-RESOLUTION-FACT`).
The shipped comment on `declarationProgram` (`tests/helpers/exportGraph.ts`) now
cites `.claude/rules/platform-facts.md`, *TypeScript abandons a module lookup
whose directory the host denies*. Nine `tests/` sites cite that page today, three
of them by section name.

Both mechanisms that make such a citation load-bearing stop short of `tests/`:

- `platform-facts.md`'s frontmatter scopes to `src/**`, `bin/**`, `scripts/**`,
  `examples/**`, `.flume/chain.ts`. An agent editing a test helper never has the
  page loaded, so the pointer resolves for a human reader and for nothing else.
- The comment-citation scan judges `src/` and `harness/` only, because
  `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* scopes
  its carve-out to exactly those two trees. Renaming a cited section leaves all
  nine `tests/` citations standing silently.

Both loci are the human's: the frontmatter is a rule page's own header, and
widening the scan without widening the carve-out would have the suite enforce
more than the page says.

**The carve-out's stated reason is what makes this a question rather than an
edit.** It admits `src/` and `harness/` comments because the package ships them;
`tests/` prose the package never ships is "prose the authors hold." A `tests/`
citation is the same token pointing at the same heading, so the reason for the
line is the fork, not the line.

Options:

- **Widen both** (recommended) — add `tests/**` to the frontmatter and `tests/`
  to the carve-out's tree list; the scan follows in one entry. A citation is a
  token resolved against the working tree, not a sentence read for meaning, so
  the shipped/unshipped distinction does not bear on it.
- **Widen the frontmatter only** — the page loads where it is cited, and the
  citations stay unresolvable. Cheapest, and leaves the rename hazard standing.
- **Neither, and stop citing by section in `tests/`** — comments in `tests/`
  name the page without a heading, so a rename cannot strand them. Loses the
  pointer's precision at nine sites.

## The win32 lane's fixtures cannot express themselves on win32 (PARKED — spec/rule decision)

Drained from the `windows` lane, run 35006280219 (44 failed, 13 files). Two
families routed to the queue (`FIXTURE-ROOTS-SPEAK-GITS-PATH-ALPHABET`,
`PRIOR-ATTEMPTS-ABSENCE-IS-PROVEN-NOT-INFERRED`). The rest share one shape:
the *fixture* is POSIX-only, so the case cannot reach the engine behavior it
names, and the lane reds on the setup rather than on a defect.

`spec/cli.md`, *win32 is a supported host* says the lane is a plan input and
that "a win32 fix carries the lane-observed input as its fixture." It does not
say what the lane runs. It runs the whole default suite, including cases whose
subject is POSIX error semantics.

Families still parked, with the titles they are keyed by:

- **Permission-bit denial.** `chmod(dir, 0o000)` / `0o444` is the suite's
  denial primitive; on win32 it toggles a read-only attribute and denies
  nothing, so every "unreadable" case reads as readable. In
  `friction.test.ts` (*reads 'friction: unreadable' (not silence) when the
  declared dir exists but readdir fails for a non-ENOENT reason
  (dispatcher-frictioncountline-loud-or-nothing)*); `loopSupervisor.test.ts`
  (*logs 'friction: unreadable' at hibernation instead of silently omitting
  the line, when the declared dir exists but readdir fails for a non-ENOENT
  reason (dispatcher-frictioncountline-loud-or-nothing)*); `job.test.ts`
  (*frictionCount reads null (not 0) …*, *readPendingLoose rethrows a
  non-ENOENT stat/read failure …*, *jobStatus reads a non-ENOENT pending.json
  read failure for one job as unparsable …*, *real CLI: renders a null
  frictionCount as 'friction: unreadable' …*, *liveLoopPid rethrows a
  non-ENOENT stat failure …*, *jobStatus reports a job whose awake dir cannot
  be read as a null awake, not as hibernating*, *jobStatus never hides sibling
  jobs when one job's awake dir cannot be read*, *jobStatus rethrows a
  non-ENOENT read failure on the jobs root …*); `Dispatcher.test.ts`
  (*readMergingMarkers throws when the merging dir cannot be read for a reason
  other than absence*, *a directory that cannot be removed (EBUSY) warns once
  at run level and does not abort the run*).
- **A cwd past ~260 characters.** The fixture nests the tree the case needs and
  then runs git in it, which win32 refuses (`spawn git ENOENT`) — the fix these
  cases pin is exactly what the fixture needs in order to be built.
  `job.test.ts` (*jobRm finds and removes a job whose dir nests past win32's
  ~260-char limit*, *jobNew doesn't misread an existing chain.ts or seedDir as
  absent when configDir/seedDir nests past win32's ~260-char limit*);
  `Dispatcher.test.ts` (*readPending/readPendingTolerant/commitPendingUpdate
  don't misread an existing or writable pending.json as absent when pendingPath
  exceeds win32's ~260-char limit*).
- **`ln -s` in a declared setup.** `harnessRunner.test.ts` (*the vitest runner
  provisions a base checkout through the declared setup*) shells `ln -s` for the
  base checkout's `node_modules`, which fails on win32 — and which
  `platform-facts.md`, *pnpm deletes a symlinked `node_modules` on install*
  already says not to do.
- **A CRLF checkout.** `examples.test.ts` (*the CHAIN-AUTHORING slicePhase quote
  matches examples/cascade-chain.ts modulo indentation and comments*) matches
  fences with a literal `\n`; the runner's git checks out CRLF. The repo pins
  `core.autocrlf false` in *temp* repos only, and carries no `.gitattributes`.
- **A symlink loop.** `Baton.test.ts` (title trimmed; `tests/Baton.test.ts:130`)
  provokes ELOOP through a symlink loop, which win32 will not create unprivileged.

Eight further reds are keyable only by `file:line` this tick — their titles sat
in the log's trimmed head (`CI-LANE-LOG-SHEDS-ITS-FORGE-DECORATION` is what makes
the next drain able to name them): `cli.test.ts:965`, `:1999`, `:2834`;
`cliHelp.test.ts:742`; `cliJobVerbs.test.ts:311`, `:359`;
`Dispatcher.test.ts:479`; `Baton.test.ts:130`. By their assertions, all eight are
in the families above.

**Why this is a question and not five entries.** Each family's fix is a different
architecture, and the cheapest one for each is a different answer to the same
unasked question: *what is the win32 lane for?* Proving the engine's win32 paths
(shim spawn, total path length, separators) is one thing; proving that a POSIX
permission bit denies on Windows is another, and the suite currently asks for
both. Answering per-family invents that stance five times.

Options:

- **Give the suite a platform-neutral denial primitive** — one helper that denies
  structurally where the code path allows it (a plain file where a directory is
  expected, the precedent `priorAttempts.test.ts` already states and gives its
  reason: "a root-run test would bypass" a permission bit), and refuses loudly on
  a host where it cannot deny. Fixes the largest family at the mechanism. Leaves
  the cases with no structural substitute — `cli.test.ts`'s readdir-succeeds /
  stat-fails arm says so at the site — still needing an answer.
- **Declare the lane's subject** — amend `spec/cli.md`, *win32 is a supported
  host* to say which cases the win32 lane is expected to carry, and let a case
  whose subject is POSIX error semantics declare its host and skip with that
  reason stated. Honest, and it makes "green on windows" mean something; it also
  writes down that some engine behavior is pinned on one platform only.
- **Fix each family where it stands** — five separate mechanisms, no stance.
  Cheapest per entry, and the sixth family arrives with nothing to appeal to.

Two items are the operator's under any ruling: `.gitattributes` is outside
build's fence, so the CRLF family cannot be fixed at its real locus by a tick;
and `platform-facts.md` should gain the win32 facts this run bought — `chmod`
denies nothing on win32, and `tmpdir()` can hand back an 8.3 short path git
never uses.
