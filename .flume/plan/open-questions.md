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

## A signalled loop's teardown stops at the tick child, and nothing bounds the wait it does make (PARKED — needs a spec ruling)

Drained from `A-SIGNALLED-LOOP-TAKES-ITS-TICK-CHILD-WITH-IT`'s note, both legs
re-verified on disk at 54f8e4c. The entry shipped the release the section
promises for the one level it reaches; these are the two things it does not
reach, and neither is a build decision.

**Reach — one level.** `defaultTickRunner` (`src/loopSupervisor.ts`) aborts by
`child.kill("SIGTERM")` on the `flume tick` child and resolves on that child's
`exit`. A real `claude -p` is that child's own child, with its own pid: it
survives, still writing into the tick's worktree, while `loop.pid` and the tip
claim have already been released and are free for the next acquirer — which is
the one-writer-per-tip property `spec/loop.md` *The loop lock and the tip
claim* declares. Same shape under a bare `flume tick`: its `SIGTERM` handler
(`src/cli.ts`) releases the claim and `process.exit(143)`s without awaiting the
agent it started. The section scopes release-on-signal to POSIX and says tick
children run under the supervisor's claim; how far the teardown reaches it
never says.

**Bound — a coincidence.** The await is bounded only because the child installs
no handler: `src/cli.ts` installs `SIGINT`/`SIGTERM` handlers on the bare-tick
branch alone (gated on `FLUME_TIP_CLAIM_HELD`), so a loop-spawned child dies at
the kernel even when parked in sync work. If one ever installs one,
`terminate()`'s kill-then-await never returns and a signalled `flume loop`
hangs with both guards still held. There is no escalation, and the dependency
is stated in neither module.

**Options.**

1. *Rule the current reach correct* — the tree below the tick child is the
   agent's own — and declare the dependency at the supervisor, which
   `engineering.md` *Loud or nothing* already requires of a
   degraded-but-proceeding path. Cheapest, and leaves a live grandchild writing
   into a state root whose guards are gone.
2. *POSIX process-group teardown*: spawn the tick child `detached: true` and
   abort with `process.kill(-pid, "SIGTERM")`; win32 keeps today's single-level
   kill and stale-reclaim, exactly as the section already scopes
   release-on-signal. Closes the loop-spawned and bare-tick shapes together,
   provided `Agent`'s spawn joins the group.
3. *Bound the wait rather than widen it*: `SIGKILL` escalation after a grace
   period in `defaultTickRunner`, entering as a chain-overridable
   `supervisorPolicy` default (`engine-boundary.md` *Routing rule* — policy
   constants are never fixed behavior). Answers the bound, not the reach.

**Recommended:** 2 and 3 are independent and compose; 1 alone leaves the
section's own property untrue under a kill. Whichever is taken, the spec
sentence moves first — `spec/` is the human's. A second fork rides on 2: an
agent that survives its *worktree's removal* is a different failure from one
that survives its parent, and only the first is closed by the group.

## The never-deny-a-parent rule has no exception for a reader that descends (PARKED — needs a rules amendment)

Drained from `MERGING-MARKERS-PROVE-ABSENCE-FROM-THE-PATH`'s note, verified on
disk. `.claude/rules/platform-facts.md`, *win32 reports a path through a
non-directory as not found*, closes with "never deny a fixture's *parent* to
stand in for denying the read — that un-arms the case on both hosts", and
`tests/helpers/denial.ts`'s head comment states it flatly the same way.

The reason holds for an **errno-keyed** reader: a lookup through a plain file
answers `ENOENT` on win32, so an existence gate above the denial takes its
absent arm and the case reads green over a path it never exercised. For a
reader that proves absence by **descending** (`isDirectoryOrAbsent`,
`src/fsProbe.ts`) it is inverted — the obstructed parent is the only fixture
that exercises the property, because it is the arm a single stat cannot make.
16e3447 ships two such cases (`tests/Dispatcher.test.ts`, *readMergingMarkers
refuses an obstructed merging dir…*, denying `flumeDir` itself; and
`tests/fsProbe.test.ts`'s descent cover), each declaring and citing the
divergence at the site.

**Nothing is broken today** — `posture-sweep.md` *Routing* never files against
a divergence the site declares and cites. What is at stake is a rule that reads
as flatly contradicted by two correct fixtures, and the next site re-deriving
the exception from scratch.

**Options.**

1. *Amend the sentence* with the exception — "…unless the reader under test
   proves absence by descending, where the obstructed parent **is** the
   property" — and shrink `denial.ts`'s copy to a pointer.
2. *Leave the rule absolute* and require every descent case to declare and cite
   at the site. This is the status quo, and it is not free: `denial.ts` is a
   rung-below copy of the same sentence (`engineering.md` *Narration is the
   ladder's bottom rung*), so the two drift as soon as one is amended alone.
3. *Name the shape in a helper* — a `denyAncestor` beside `denyDirectory`/
   `denyFile` whose doc carries the exception, so the rule's sentence stays
   about the un-arming shape and the sanctioned one has an address a sweep
   finds.

**Recommended:** 1 and 3 together — the exception is one clause, and a named
helper is where the next author looks. `.claude/rules/**` is the human's lane;
`tests/helpers/denial.ts` is build's and follows once the rule moves.
