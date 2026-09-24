# The groomer prompt's task body still hardcodes the chain's two path constants

Shipped: `examples/prompts/backlog-groomer.md:29` now points at the
`<harness>` block instead of spelling the fence, matching `build.md:27`.

Observed while there, not built (out of the entry's scope, and it touches the
chain, not the prompt): the fence copy was the second copy of those two
filenames, not the first. The prompt's TASK body states them as literals four
times — `:3` ("Read `BACKLOG.json`"), `:15`, `:16`, `:21` — while the chain
holds them as `BACKLOG_PATH` and `SHIPPED_PATH`
(`examples/backlog-groomer-chain.ts`), which is where `writablePaths`, the
parse gate's message and the shipped-ledger writer all read them from. A
deployment renaming either constant leaves the prompt telling the agent to
read a file the phase no longer writes — the copy reading authoritative while
stale, same section.

The mechanism is already in the file: `promptArgs()` returns
`BACKLOG_SCHEMA`, so `{{BACKLOG_PATH}}` and `{{SHIPPED_PATH}}` cost one line
each and make the constants the single home. That is a chain edit plus a
prompt edit, which is why I left it for plan to file rather than widening
this entry.

Two names the prompt is right to keep spelling: the `groom:` commit prefix
and the `- <tag>: <reason>` ledger line, both of which the chain does not
hold as values the prompt could interpolate. The `groom:` prefix is stated in
the phase `name` and in the prompt twice; worth a look only if the
positional-pointer family gets swept again.

No test covers the prompt's prose — `examples/prompts/` is outside the
ladder's judged surface, so this change ships on the suite's existing render
cases alone (`tests/examples.test.ts`, 50 green).
