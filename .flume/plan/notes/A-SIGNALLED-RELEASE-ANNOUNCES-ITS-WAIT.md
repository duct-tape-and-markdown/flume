# The tick names its grace by resolving the chain twice

To name the grace at receipt the bare-tick handler needs
`supervisorPolicy.killGraceMs`, and the CLI holds no such fact: the dispatcher
resolves the chain inside `tick()` and computes the bounds in `agentBounds`
(`src/Dispatcher.ts`), which report nowhere. So the tick branch now makes a
second best-effort `resolveChain()` of its own - a duplicate factory
application per tick process, and an engine fact rediscovered by the engine's
own CLI (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
never rediscovered*). Declined alternative: injecting a recording
`chainLoader`, the documented unit-test seam, which would apply to every
subcommand. If plan wants the reported-fact shape, the entry is on the
dispatcher surface, not on `src/cli.ts`.

Also: the signalled-tree arms in `tests/cli.test.ts` (six now) blew the 10s
pid-file `waitFor` ceiling when several ran concurrently under one `-t`
filter. Each passes alone and the full default lane is green.
