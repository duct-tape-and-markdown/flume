# A contention flake reverted two entries, and the package judge starves the engine's flake heuristic (interactive session)

Observed at d9f0a90, loop 23. Two unrelated entries each reverted at the afterMerge judge on the same case, `tests/builtinGates.test.ts` "tscGate({ cmd: 'npm', … }) composes a working npm invocation and actually runs tsc": it spawns a real `tsc` (3 s alone) under vitest's 5 s default while a sibling worktree installs beside it, and passes in isolation. The carve-out amended this pass says a spawning case declares a per-case budget; this one does not.

Second: the judge's verdict carries `failingFiles` (`harness/judge.ts`), but the named-lines gate in `harness/gates.ts` builds its `GateResult` without them, so `suspectFlake` (`src/priorAttempts.ts`, needs `failingFiles` disjoint from the span) never fires and a flake on an unrelated file reads to plan as a wall.

Why it matters: two waves lost to one undeclared budget, and the mechanism that tells a flake from a defect was starved. Route: a budget on that case, and the named-lines gate passing the judge's `failingFiles` through.
