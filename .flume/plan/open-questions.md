# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Does the spec's helper-name ban bite the bare name, or only the qualified one?

**Status: PARKED** — `.claude/rules/spec-writing.md`, *A claim names behavior,
never location*.

The clause says a spec sentence may not name "an internal helper", with the
test: could build rename this without changing observable behavior? Read
literally that condemns roughly thirty sites across `spec/*.md` —
`superviseLoop` (8), `createWorktree` (6), `runFanout`, `removeWorktree`,
`writeTickVerdict`, `readPendingTolerant`, `substitutePlaceholders`,
`loadChainModule`, `buildFlumeApi`, `defaultTickRunner`, `harvestFriction`,
`writeRevertNote` and the rest. Verified: none of those ten resolve in
`src/index.ts` or `harness/index.ts`, so none is public surface under the
clause's own carve-out.

The 2d376b1d ruling de-named three sentences, and all three shared a form the
rest do not: **`Dispatcher.`-qualified** (`Dispatcher.AgentTermination`,
`Dispatcher.invokeAgent`, `Dispatcher.writeRevertNote`), each falsified by the
extraction that moved the symbol to `src/tickAttempt.ts`. The same commit left
`spec/worktrees.md`'s bare `writeRevertNote` (:279, :333) standing while
rewriting the qualified one in `spec/pending.md` — which reads as intent, not
oversight.

**Options.**

- **(a) The qualified form is the defect; the bare name is permitted
  shorthand.** `Type.member` claims a home, and homes are build's lane; a bare
  name is shorthand for the behavior the symbol produces and survives any
  move that keeps the name. Costs one clarifying sentence in spec-writing.md.
  Buys a *checkable* clause: a pin can resolve qualified cites in `spec/`
  against the declarations, which the bare form could never support.
- **(b) The clause binds as written.** Thirty-odd sentences want restating as
  behavior — a corpus-wide spec edit, human-authored, and every derive tick
  until it lands re-files the same finding.
- **(c) Scope the ban to symbols that moved.** Matches the ruling's observed
  behavior exactly but is undecidable at read time: nothing in the sentence
  says whether its symbol has moved.

**Recommended: (a).** It is the only option that leaves the clause mechanical,
it matches what the ruling actually did on both sides, and it keeps the
corpus's readable shorthand. If (b) is wanted instead, the edit is the
human's and wants its own landing — derive cannot write `spec/`.

## Does `flume --help <name>` answer for that name, or refuse it?

**Status: PARKED** — `spec/cli.md`, *Subcommand surface*.

The spec names three help spellings and rules on all three: every subcommand
answers `--help`; `flume --help` lists all subcommands and `flume help` "is
the same answer"; `flume help <subcommand>` is that subcommand's `--help`,
"and an unknown name there is usage-shaped (exit 2) like a trailing positional
anywhere else, never silently dropped". It says nothing about a name trailing
the *flag*.

On disk that gap is a silent drop: `src/cli.ts:271` gates the trailing-name
lookup on `firstArg === "help"`, so `flume --help status` prints the top-level
page and discards `status`. The comment at the site (`src/cli.ts:266`)
condemns exactly this shape — "a name this surface holds no page for refuses
usage-shaped rather than answering the top-level page over an argument it
dropped" — for the verb arm only. Since
FLUME-HELP-ANSWERS-FOR-A-SUBCOMMAND shipped, this is the one place in the CLI
where argv is discarded rather than honored or refused.

**Options.**

- **(a) Answer with that name's page.** One more arm on the same branch,
  through the same decider (`helpPageFor`, `src/cliHelp.ts`); an unknown name
  exits 2 as the verb arm's does. Reads the spec's "`flume help` is the same
  answer" as covering the trailing form too, which is the symmetry an operator
  assumes. Cost: `flume --help status` and `flume status --help` become the
  same page — harmless, but a fourth spelling to keep working.
- **(b) Refuse usage-shaped (exit 2).** Reads the spec's own class — "any argv
  the surface cannot honor as typed", whose stated harm is "running something
  other than what the operator typed" — as governing, since `--help`'s
  declared contract is the top-level list and nothing else. Cost: an operator
  who guessed the composite spelling gets a refusal where the verb spelling
  answers.
- **(c) Leave the drop.** Costs nothing now and keeps one surface where argv
  vanishes, which is the shape gh#1 was filed over.

**Recommended: (a)**, weakly. Both (a) and (b) close the drop, both are a
one-line change on that branch, and each has a spec sentence behind it — which
is why this is a fork rather than a derivation. (a) keeps one decider serving
every spelling of "help for <name>"; (b) keeps `--help`'s contract narrow. A
sentence in *Subcommand surface* naming the flag form closes this either way,
and that sentence is the human's: neither plan nor build writes `spec/`.

## Does the supervisor state when a run started, or does `flume status` keep measuring it?

**Status: PARKED** — `spec/loop.md`, *The loop lock and the tip claim*.

`spec/cli.md`'s *`flume status` owes exactly this* (item 7) bounds the live
run's spend to "the verdict rows written since it started". Nothing on disk
states when a run started: the same page's sibling section pins `loop.pid`'s
contents to "the holder's pid, nothing else", and the tip claim's *Contents:*
mirrors that spelling ("consistent with `loop.pid`").

So status measures it instead. `src/cli.ts:455` stats the pidfile once — the
probe it already needs for liveness — and takes `mtimeMs` as the window start;
`TickVerdict.at`'s doc (`src/tickVerdict.ts`) names that reader. Verified on
disk: the supervisor exclusive-creates `loop.pid` once at claim
(`src/cli.ts:1264`) and unlinks at release, never rewriting it, and a stale
lock is unlinked and re-created — so within any run the mtime *is* the claim
instant. The measurement is correct today.

The gap is that mtime carries no writer contract. It is a filesystem property,
not a statement the engine made: an archive restore, a `cp -a`, a coarse
mtime-granularity host, or any tool that touches the state root moves or blurs
it, and nothing refuses. `engine-boundary.md`'s *Told, not inferred* test —
could the counterparty have said this outright? — answers yes here; the
sanctioned exception is for a counterparty that *cannot* speak, and the
supervisor can.

**Options.**

- **(a) Keep the measurement.** Declared and cited at the site, zero spec
  churn, and one probe already serves both readings. Cost: a fact the engine
  holds stays unstated, and its one reader is silently wrong — a spend line
  over the wrong window, at exit code 0 — if anything ever touches the file.
- **(b) `loop.pid` carries the pid and the claim instant.** The engine says it
  outright. Costs two spec sentences: *Contents:* in *The loop lock and the tip
  claim*, and the tip claim's "consistent with `loop.pid`" (which either
  follows or is explicitly excepted). **Ordering hazard, measured:**
  `liveLoopPid` (`src/job.ts`) reads the whole file through `Number(raw.trim())`,
  so a `0.x` reader meeting a two-line file gets `NaN` → `null` → *stale*, and
  reclaims a live lock. The new line must land where an old parser still reads
  the pid, or the bump is breaking and the migration note says so.
- **(c) A second file beside the lock carrying the instant.** Leaves both
  *Contents:* sentences intact, but spends an artifact on one fact and a second
  release path — and a lock and a start stamp that can disagree is a worse
  reading than the mtime.

**Recommended: (b).** It is the only option that turns the measurement into a
statement, and the sentence it needs is one line. Take (a) deliberately if the
mtime's fragility is judged not worth a wire change — but then the site's
citation should say *that*, rather than reading as an interim. Either way the
edit is the human's: neither plan nor build writes `spec/`.
