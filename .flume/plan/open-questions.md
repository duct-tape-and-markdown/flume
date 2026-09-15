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

## `spec/chain.md` names five supervisor knobs; the ruled grace is a sixth (NEEDS AMENDMENT)

`spec/loop.md` *The loop lock and the tip claim* (51b3ae7) now has the signal
handler "escalate to `SIGKILL` after a bounded grace the supervisor declares",
and the closing ruling routed that grace to `supervisorPolicy` — chain-
overridable like the other five, per `engine-boundary.md` *Routing rule*.
`spec/chain.md` *Supervisor policy is a chain-overridable default* still spells
the block as exactly five fields and splits their read scope as a principled
pair. A sixth knob leaves that section stating a type the engine no longer has.

**Not blocking.** A-SIGNALLED-LOOP-TAKES-DOWN-THE-WHOLE-TICK-TREE ships on
loop.md's bullet plus the routing rule; this is the corpus catching up to a
knob the ruling already decided. Three things the amendment settles, so build
is not choosing them silently:

- **Name and default.** `killGraceMs` reads beside `tickTimeoutMs`, and 5000 ms
  is the recommendation — long enough for a `claude -p` to flush, short enough
  that an operator's second Ctrl-C is not the real mechanism. 10 000 is the
  defensible alternative if a tick's last write is worth more than the wait.
- **Read scope.** The section's split says run-scoped is for run-scoped
  accounting, and this knob accumulates nothing — but the supervisor builds its
  tick runner once per run from the one chain resolve `flume loop` makes at
  start, so on that path it is bound once per run whatever the principle says.
  On the bare-tick path the same knob is read per tick, off that tick's own
  chain. That asymmetry wants a sentence, or a ruling that the loop path
  re-reads it per tick.
- **Whether the bare tick reads the same knob at all.** The bullet says a bare
  `flume tick` takes its agent down "the same way"; `supervisorPolicy` is named
  for the supervisor, and a bare tick has none.
