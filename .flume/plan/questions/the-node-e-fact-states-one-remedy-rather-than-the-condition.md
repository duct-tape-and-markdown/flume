# Does the `node -e` platform fact state the condition, or one remedy?

`.claude/rules/platform-facts.md`, *`node -e <code>` parses later `--opts` as
node's own* is true as written. Its remedy clause is the part in question:

> A fixture standing in for a tool as `process.execPath -e …` ends its own
> arguments with `--`, so the flags a runner appends reach the script.

That reads as a requirement on every such fixture. The condition is narrower.
Measured here, node 24.21:

- `node -e "" --reporter=json` -> 9, `node: bad option`
- `node -e "" run --reporter=json --outputFile=…` -> 0, silent

Node stops parsing its own options at the first non-option positional. Every
spawn the vitest runner makes leads the flags it appends with a subcommand —
`capture` prepends `run`, the file lister prepends `list`
(`harness/vitestRunner.ts`) — so no fixture standing in for that runner needs
the `--` at all.

**What the unconditional reading already cost.** A plan tick derived
`THE-NO-REPORT-FIXTURE-REACHES-ITS-SCRIPT-PAST-NODES-OPTIONS` from it: the
entry measured the bare form, concluded the `refuses a run that produced no
report` case never reached its named arm, and a build tick parked it after
measuring that the arm is reached today and nothing needed shipping.

## Options

1. **State the condition.** Node ends its own option parsing at the first
   non-option positional, so a fixture needs `--` only where nothing
   positional precedes the appended flags. Sharper, and
   `engineering.md`, *Prefer the condition to the era* asks prose to state
   what would change the decision. Cost: the reader evaluates a condition
   instead of following a rule.
2. **Keep the remedy as an unconditional convention, and say that it is
   one.** `--` is cheap and never wrong, so the page recommends it rather
   than describing node. Cost: the inert `--` in `tests/harnessRunner.test.ts`
   stays, as convention rather than residue.
3. **Both** — state the condition, then recommend `--` as the spelling that
   holds without evaluating it.

**Recommendation: 1.** The unconditional remedy is what produced the phantom
entry, and the page's own posture ("state the consequence, name what to do
instead") survives the condition being named.

Either way the test-side comment is wrong on its own terms — it credits the
`--` for reaching the script where the `run` positional is what does — and
`THE-RUNNERS-SPAWNS-LEAD-THEIR-APPENDED-FLAGS-WITH-A-SUBCOMMAND` carries that
half without waiting on this ruling.
