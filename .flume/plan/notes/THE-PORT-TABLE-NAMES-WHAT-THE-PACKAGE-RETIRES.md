# Adopting retires an agent decorator with nothing to replace it

Writing s6's retire list surfaced one gap that is not a doc defect.

`declaration.agents` is `strict({ model, extraArgs, inheritUserMcp })`, and
`agentFactory` (`harness/chain.ts`) composes
`withTerminalRenderer(withSessionCapture(claudeCode(...)))` with no injection
point. A consumer whose chain wraps the agent with one of its own — the
cost/token tee consumer-a carries (`docs/surveys/consumer-chains/consumer-a.md`,
S7, upstream flume#10) — deletes it on adoption and gets nothing back. I filed
it in the note's "What has no declaration field" list, which is honest but
records the gap rather than closing it. Worth deciding whether the package
takes an outermost-decorator field or the engine reports the telemetry that
made the wrapper exist; either way a harness/engine entry, not a doc one.

Scope kept to 0.16 per the entry: `setup.serialize`, jobs and the gate-facts
surface stay for their own note.
