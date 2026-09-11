# No fifth site; the fence that replaced it is a text scan

Scanned `tests/**` line by line for all three re-derivation shapes (the `??`/`||`
default, the `err as { code?: number }` cast, the `typeof e.code === "number"`
narrowing): the four sites plan named were all of them. No fifth.

Two of the four were more than a bad extraction — `runTick`/`runLoop` in
loop-process-boundary re-implemented `runCli` whole, argv and all. They are now
one-line delegations, and `runNodeStreams` (the spawn + `exitStatusOf` read,
generic over the entry point) is the shared mechanism `runCliStreams`, the dist
CLI and the changelog script all go through.

Debt, not filed: the fence is a text scan because nothing typed stops a suite
from reaching for `promisify(execFile)` itself — 22 of 27 suites import
`node:child_process` today, mostly to drive git. A `tests/helpers` spawn surface
that left no reason to import it would move this check a rung up
(`engineering.md`, *Narration is the ladder's bottom rung*). Shape, not
correctness — re-noting is cheaper than a queue entry.
