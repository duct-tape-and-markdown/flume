# The tick exit-code gate pins the range; who owns the per-arm cause?

From note `AN-UNKNOWN-PHASE-EXITS-2-AT-EVERY-VERB`, verified on disk this
tick. `tests/cliHelp.test.ts` drives `tickExitCode` over the whole
`TickOutcome` space and compares the **set** of codes it returns against the
codes `flume tick --help` and `docs/CLI.md` § `flume tick` name
(CLI-HELP-TICK-MISSING-EXIT2, CLI-DOC-TICK-EXIT-CODES-PINNED). The set is all
it compares. Moving `undeclaredPhase` from 1 to 2 left both pins green — 1
stays reachable through `ledgerRefusal: "commit-refusal"` — and only an
end-to-end case in `tests/cli.test.ts` reddened.

So the standing gate proves "the pages name every code the verb can return"
and nothing about which outcome maps to which code. Any future re-routing
between two codes already in the range ships green over both prose copies,
and the per-arm claim is exactly what those copies carry: each code's block
in `--help`, and each cause clause in `docs/CLI.md`, names causes nothing
reads back against the producer.

`sentencesNamingExitCode` (same file) is the reader that could close it — it
already scopes a `docs/CLI.md` window to one code, and the loop section's I/O
case pins artifacts named in that window against what real refusals report.
What it needs is a source of truth for *what* each arm's sentence must say,
and that is the decision.

Forks:

- **Label the outcome space.** Each candidate in `TICK_OUTCOME_SPACE` carries
  the phrase its arm should be documented under; the check asserts the
  sentences naming that candidate's code contain it. Smallest diff, lives
  entirely in the test tree. Cost: a phrase table in a test file that a
  reworded help block reds, maintained by hand beside the prose it quotes.
- **One cause map in the producer.** `src/cliVerdict.ts` labels each arm
  once; `--help` renders its exit-code block from that map, and `docs/CLI.md`
  is pinned against it. The two prose copies stop being copies — the help
  text becomes derived, and only the page restates
  (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). Larger,
  and it puts documentation strings in `src/`, which the engine boundary
  reads as surface a chain never consumes.
- **Leave it, declared.** The range pin is the claim; per-arm causes stay
  review's. Cite the limit at the two describe blocks so the next reader does
  not mistake green for an arm check.

The note declined to build fork 1 inside its entry's scope, calling it a
design decision rather than a mechanical extension. The second fork is the
one a `The fix lands at the mechanism` reading reaches for, and it is the one
that needs a human — it moves prose into the engine.
