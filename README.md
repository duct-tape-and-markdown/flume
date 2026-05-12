# Flume

A disciplined harness for AI-derivation pipelines.

## Posture

- **Disk is truth.** Every tick is a fresh agent invocation reading committed artifacts. No sessions, no in-memory continuity.
- **Stateless ticks.** One tick = one phase × one agent invocation = one commit (or zero).
- **Harness enforces, prompts state.** Validation gates, capability scoping, output shape, and baton mechanics live in the harness. Prompts say what the agent produces, not what discipline to remember.
- **Conservative derivation.** A derived layer never invents intent absent from its source.
- **Structured handoff.** Inter-phase contracts are JSON schemas, not prose conventions. Markdown is reserved for documentation and prose surfaces.

## The chain

A `Chain` is an ordered list of `Phase`s. Each Phase declares its own prompt, writable paths, concurrency model, gates, and handoff rules. The default chain (in `examples/cascade-chain.ts`) reproduces the workshop → specs → plan → code pipeline that Flume was originally built for; other projects supply their own.

## Status

v0 in flight. Triangle (`PendingSchema.ts` + `Phase.ts` + `cascade-chain.ts`) is the load-bearing shape. Dispatcher, Tick runtime, and worktree fanout follow once the shape is reviewed.

## Project intent

See `docs/INTENT.md`.
