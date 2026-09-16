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
