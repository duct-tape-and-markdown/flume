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

## Does a signalled loop's outer grace nest over the tick child's own? (PARKED — a design call plus a spec amendment)

Drained from `A-BARE-TICK-TAKES-ITS-AGENT-DOWN-THE-SAME-WAY`'s note
(db16e6c). Verified on disk this tick: `defaultTickRunner`
(`src/loopSupervisor.ts`) terminates the tick child's group with
`terminateProcessTree(child, { graceMs })`, `graceMs` being the chain's
`supervisorPolicy.killGraceMs`; the tick child's own handler
(`src/cli.ts`, `releaseAndExit`) aborts its tick and awaits an agent
teardown bounded by that same value. Two timers, one number, and the
supervisor's starts first — so at T+grace the supervisor SIGKILLs the tick
child while the child's own escalation is still milliseconds away.

**The common case is strictly better than before**: the supervisor's release
now waits on the agent's real exit, which it never did. The pathological one
is new — an agent that swallows SIGTERM for the whole grace is orphaned under
a loop, where the old shared process group killed it.

`spec/loop.md` *The loop lock and the tip claim* reads one group short either
way: "the tick child runs in its own process group, the handler signals that
group … so the release is the whole tree's" describes one group where the
agent now leads a second.

Options:

- **The supervisor delegates.** Signal the child's group and wait on the
  child unbounded; the one timer in the tree lives at the level that owns the
  agent. This is already the argued position one level down — `src/cli.ts`
  says of the bare tick's wait, "exiting anyway is the release-over-a-live-
  writer this whole path exists to stop". Removes a timer rather than adding
  a constant. Cost: a child wedged *after* installing its handler holds the
  run open, which is the intended outcome by that same argument.
- **The outer grace nests.** The supervisor's bound becomes the child's plus
  a margin for the child's own escalation and reap. Keeps a backstop at every
  level; costs a margin constant in the engine, which is a policy number
  (`engine-boundary.md`, *Routing rule*) and wants to be chain-overridable if
  it exists at all.
- **Two declared knobs.** Per-level grace on `supervisorPolicy`. Most
  explicit, and the most surface for a distinction almost no chain author
  wants to reason about.

Recommended: the first. Established practice nests an outer timeout over an
inner one, but here the inner level is the only one that can see the agent at
all, and the outer one's job is to not release a guard over a live writer —
which a timer at that level is precisely how it fails to do.

