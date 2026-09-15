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

## `spec/chain.md` still calls `killGraceMs` the supervisor's, which `spec/loop.md` no longer is (NEEDS AMENDMENT — spec edit, two passages)

Surfaced draining the ruling at d9e80fe. `spec/loop.md` *The loop lock and the
tip claim* now has the supervisor signal the tick child's group and wait
unbounded, the one timer being the child's over its agent. `spec/chain.md`
*Supervisor policy is a chain-overridable default* still reads from before
that, in two places:

- The section preamble calls the knob "the grace a signalled release gives the
  in-flight **tick tree** before `SIGKILL`". Post-ruling no release gives the
  tick tree a grace; the grace is what a tick gives its **agent** tree.
- The read-scope bullet classifies it run-scoped: "On the loop path that is
  the supervisor, which binds it once per run … a mid-run change is not seen
  until `flume loop` restarts." The supervisor binds nothing once the
  delegation lands, and the tick child reloads `chain.ts` every tick — so the
  bullet's conclusion inverts to the per-tick one beside it.

The fork is the second bullet, and it is a classification the engine then
owes: **does `killGraceMs` move to the per-tick group?** Mechanically it
already would — the only reader left is the tick child, which resolves its own
chain per tick, so a committed change governs from the next tick with no
restart. Saying so is a one-line move of the bullet. Saying anything else
means the engine keeps a run-scoped binding with no reader, which is the dead
plumbing the delegation removes.

Recommended: move it, and re-word the preamble to name the agent tree. Both
are edits to a page plan may not write.

Blast radius for the queue: `docs/CHAIN-AUTHORING.md` carries both passages
downstream and cites that section by name (the `killGraceMs` bullet and the
"fields split by when they are read" paragraph). Left out of
THE-SUPERVISOR-DELEGATES-THE-RELEASE-GRACE deliberately — correcting the page
out of `spec/loop.md` alone would put `docs/` against a standing
`spec/chain.md` sentence. The doc edit ships the moment the spec line moves.
