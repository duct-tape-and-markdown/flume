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

## A lane woken over a run whose log the forge never surrenders holds the inbox slice live with no way out (PARKED — needs a spec amendment)

Drained from `.flume/plan/notes/RENDER-NAMES-THE-LANE-THAT-WOKE-THE-TICK.md`
(2026-09-15, build tick). Verified on disk: `wokenLanes`
(`harness/windows.ts`) reads the status half alone — a lane whose latest
completed run failed past its `drainedRuns` stamp wakes the inbox slice
whether or not the job's log then comes back. ac059c2 made the case *visible*
(the rendered block names the lane and the run it woke over) but nothing
closes it: a forge that holds the run and refuses its log — auth scope,
expired retention, a deleted artifact — wakes the slice every tick forever,
drains nothing, and never hibernates.

**Not derivable as filed.** `spec/harness.md`, *CI lanes as a findings
source*, says the slice "stamps the run it drained", and an unfetchable run
was not drained. It also says liveness is exactly "latest completed run
failed and is past the stamp" — status-only, which is what the code does —
while its unread sentence ("a lane the slice cannot read makes it live for
nothing") covers only a lane with no status at all. The terminal case falls
between the two sentences, so closing it is a spec edit, not a derivation.

Options, one line each, all costing something:

1. **Stamp an unreadable run as drained-empty.** Ends the loop immediately;
   contradicts "stamps the run it drained", and a forge that recovers an hour
   later has its finding silently skipped.
2. **A failing status whose log will not fetch does not wake.** Keeps the
   stamp honest; the red then reaches no tick at all until a newer run, which
   is the outcome the lane exists to prevent.
3. **Bound the re-wakes** (a per-lane attempt count in the plan state). Keeps
   both the finding and the escape; adds a counter field nobody has, and a
   bound is a number with no principled value.

A fourth shape worth ruling in or out first: whether an unreadable log is a
*lane* fact at all, or an operator fact the slice should report and step past
the way it reports an unread lane today.

## A third win32 long-path ceiling has no section in `platform-facts.md` (NEEDS AMENDMENT — a human edit to `.claude/rules/platform-facts.md`)

Drained from `.flume/plan/notes/LONG-PATH-FIXTURES-KEEP-GIT-OFF-THE-DEEP-PATH.md`
(2026-09-15, build tick). The page names two win32 ceilings: *Windows
MAX_PATH (~260 chars) breaks fs calls with no long component*, which
`toNamespacedPath` fixes, and *`git worktree add` refuses long paths on
win32, below MAX_PATH*, which it cannot. Run 35016231910 showed a third:
**win32 refuses to create a process whose working directory exceeds
MAX_PATH**, surfacing as `spawn git ENOENT`. `toNamespacedPath` cannot reach
this one either — the OS resolves the cwd, so no path flume built is
involved. It is why two `runIf(win32)` job fixtures died before reaching
their subject.

**Not derivable as filed.** `.claude/rules/**` is the human's maintenance
surface; no autonomous tick writes it. The fact currently lives only in a
doc comment on `longJobName` (`tests/job.test.ts`), which is exactly the
copy CLAUDE.md says the harness should own — "a code comment carrying one is
a copy the harness should own instead, seen only by an agent that already
opened that file".

The consequence is a standing rule for every future win32 fixture, which is
why the comment is the wrong home for it: **depth goes on the subject path**
— a long job name, a deep `configDir`, a deep `pendingPath` — and never on a
directory git is spawned in or asked to add a worktree under.

The edit is one section beside the other two; the comment then shrinks to a
pointer at it, in the same commit or a build entry filed after.
