# The `run` subcommand already ends node's option parsing

Parked: premise contradicted by the tree. The named arm is reached today,
and no `--` is needed to reach it.

The entry measured the bare form, `node -e "" --reporter=json`, which does
exit 9. The runner spawns something else. `capture`
(`harness/vitestRunner.ts`) builds
`[...invocation.args, "run", ...readingAndScope(file)]`, so the argv is
`node -e "" run --reporter=json --outputFile=<file>` — and node stops
parsing its own options at the first non-option positional. Measured, node
24.21:

- `node -e "" --reporter=json` -> 9, `node: bad option`
- the same with `run` before the flags -> 0, silent

Driven through the real runner (scratch case, removed), the refusal
`refuses a run that produced no report` gets is `vitest wrote no JSON
report ... wrote nothing there`, with `Last stdout: (nothing)` / `Last
stderr: (nothing)`. No `bad option`: the child ran the empty script, exited
0, wrote no report. That is the arm — a tool that ran and wrote nothing.
Acceptance is green on the base; nothing to ship.

Two things out of it:

1. The inaccurate narration is the sibling's, not this case's. `a vitest
   run that produced no report refuses naming what its child wrote to
   stderr` carries `"--"` with a comment saying it is there so the
   appended reading flags "reach the child as argv rather than as node
   options it refuses before the script runs". The `run` positional
   already does that — there and in every spawn the runner makes
   (`listFiles` leads with `list`). The `--` is inert and the comment
   names a mechanism that is not the one holding (`engineering.md`,
   *Narration is the ladder's bottom rung*). Left alone: outside this
   entry.
2. `.claude/rules/platform-facts.md`, *`node -e <code>` parses later
   `--opts` as node's own* is true as written but reads as if a fixture
   must end its arguments with `--`. The condition is a leading
   positional, which every spawn here has. Human's call.
