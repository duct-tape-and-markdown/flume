# A top-level await under the adapter breaks chain load, and no harness chain can declare a budget yet

**Measured: a module the adapter imports may not use top-level await.**
`src/budgetHook.ts` first guarded its entrypoint with `await readAll(...)` at
module scope. Typecheck green, hook green, and five `tests/cli.test.ts`
signalled-teardown cases red — a bare `flume tick` claimed the tip and then
never invoked its agent. `tsImport` compiles a chain's graph to CJS interop
(`src/chainLoad.ts` says so), and CJS has no spelling for TLA. Silent: the
tick just stops. Chained `.then` instead. Platform-facts candidate: nothing
in the tree names it, and the next entrypoint-shaped module walks in the
same way.

**The vocabulary got its own file.** The previous note predicted the cycle
and it arrived: adapter -> hook -> budgetLine -> adapter. `src/streamJson.ts`
now holds the line parse, the event discriminants and the block walk; the
adapter and the reader both import it. Also keeps the hook process off the
spawner's graph, on a script that runs after every tool call.

**No flume-harness chain can turn the hook on.** `harness/declaration.ts`'s
`agents` shape is strict and carries `model`/`extraArgs`/`inheritUserMcp`
only, so this repo's own `.flume/declaration.ts` has no spelling for `budget`
— while `harness/prompts/build.md` already instructs on 70%/80% thresholds.
The pass-through is ~10 lines in `harness/chain.ts`; what it needs first is
whether the package recommends a window/cadence or stays silent. Not filled
silently. Left for plan.

**Verified against a live session.** Inline JSON on `--settings` does
register the hook, the input carries a transcript path, and the line reaches
the agent as a system-reminder next turn. The suite cannot reach that, so
`tests/budgetHook.test.ts` drives the rendered command through a real shell.

**`import.meta.resolve` is absent under vitest's SSR transform**, so
resolving the tsx loader goes through `createRequire`.
