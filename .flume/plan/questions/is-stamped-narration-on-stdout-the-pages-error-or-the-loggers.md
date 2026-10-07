# Stamped narration reaches stdout; the CLI page says stderr. Which side is wrong?

`docs/CLI.md`, *Narration carries the instant it was written* states the taxonomy
plainly: every stamped line the CLI writes to the operator — supervisor narration,
each tick child's lines, every verb's refusal — is **stderr**; a verb's own
unstamped listing (`status`'s rows, `log`'s history, what `wake`/`sleep`/`hold`
print) is **stdout**.

`stampedLogger` (`src/cliLog.ts`) sinks `info` to `consoleLogger`, whose `info` is
stdout. So a stamped line on stdout fits neither half of the page, and the
supervisor's and dispatcher's `info` narration lands there today. Found while
shipping `flume exclusive`, where it is not cosmetic: stdout belongs to the
operator's command, so a wait line there lands inside
`flume exclusive -- git rev-parse HEAD > sha`. That verb now builds a sink of its
own with every level on stderr, cited at the site — one consumer's choice taken
once, because the engine has no way to say "narrate this to stderr" short of
rebuilding the logger.

`spec/cli.md`, *A log line carries the instant it was written* rules the **stamp**
and says nothing about the stream, so the spec does not decide this.

- **(a) The logger is wrong.** One sink in `src/cliLog.ts` puts stamped narration
  on stderr everywhere, and `src/cliExclusive.ts`'s local sink retires into it.
  Anything parsing *narration* off stdout today changes; the page already claims
  it was never there, so nothing documented breaks. My lean, if the page is meant
  to be the contract.
- **(b) The page is wrong.** Narration stays on stdout and the page's taxonomy
  shrinks to the stamp alone. Cheapest, and it leaves `flume exclusive`'s problem
  as the verb's own forever — every future verb that runs an operator's command
  inherits the workaround.
- **(c) Split it.** Verb refusals on stderr (already true), supervisor and
  dispatcher narration on stdout, the page restated to match. Honest about what
  CI captures today, but it means "stamped" no longer predicts the stream, and a
  reader has to know which writer produced a line.

The spec is the place a ruling lands, since the page derives from it; it currently
states neither.
