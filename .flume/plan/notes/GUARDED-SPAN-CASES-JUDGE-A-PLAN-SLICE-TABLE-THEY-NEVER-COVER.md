# The refusal cases still close on a bare count

Shipped: `promptsReadingEachArtifact` now takes a roster (defaults to
`PHASES`), `expectEveryArtifactRead` takes the table slice the case renders,
and a new `pairsToAssert` gives the exact (prompt, artifact) count. Both
guarded cases (`tests/harnessPrompts.test.ts`, cold-root and no-headings) skip
by that map and close on `toBe(pairsToAssert(...))`.

Observed next door, not fixed here: `everySliceRefusesOn` (:~540) still closes
on `refused > 0`. It is per-artifact, so it cannot go vacuous the way the
guarded loops could, but two of three plan slices could stop opening the
artifact and the case stays green over the one that remains — the same
weakness one rung down. `pairsToAssert` over `[artifact]` is the close it
wants; its `opens: false` branch already asserts a positive fact, so the
change is the final `expect` alone. Not filed — correctness-adjacency is
arguable, and the count would be `readers.get(key)!.length` either way.
