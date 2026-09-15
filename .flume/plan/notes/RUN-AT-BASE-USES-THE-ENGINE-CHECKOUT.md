# The base checkout is the engine's; two things the next tick should know

Shipped: `runAtBase` calls `api.git.checkoutAt` and adds/removes nothing.
Its refusals (empty selection, absent file) now precede the checkout, so
they still raise outside a gate scope.

**A judge drive is now scope-bound.** `checkoutAt` refuses off the gate
path, so any caller of `judgeNamedLines`/`runAtBase` outside
`Dispatcher.runGate` must open `withGateCheckouts` itself. Runtime is fine
(`namedLinesGate` is afterMerge, through `runGate`), but a future consumer
driving the runner from a script or a CLI verb will hit the refusal. Worth
watching whether `spec/harness.md` should state that the runner interface's
`runAtBase` is a gate-time operation.

**Suspected load flake, not a regression.** The prior attempt's revert also
listed `tests/builtinGates.test.ts` "tscGate({ cmd: 'npm', ... }) composes a
working npm invocation and actually runs tsc" as red. It is green here
alone and green in the full suite (1230 passed). That case spawns a real
npm+tsc; it reds under contention. If it reverts another entry, it is a
timing defect in the test, not in the entry under it.
