# A third hand-list over the verdict shape, already stale

The two rosters this entry named are now keyed off `TickVerdict`: the decode
reads `ALWAYS_WRITTEN` over `RequiredTickVerdictField`, the two-producer
comparison reads a roster over `ConditionalTickVerdictFact`. Both types are
computed from the shape, so a field joining it joins both or tsc refuses.

There is a third. `tests/Dispatcher.test.ts`, "a dispatcher-produced tick
verdict carries only declared fact fields": its `FACT_FIELDS` allowlist names
19 of the shape's 23 fields — `stakeLosses`, `renderFailures`,
`platformFailures` and `shipFailures` are absent. The wave that test drives
never emits those four, so it is green; a wave that did would red on a
declared fact.

Lower severity than the two closed here, and that is why I left it: an
allowlist falling behind fails loud (false red), never green over a field
nobody checked. The fix is the same shape — a `{ [K in keyof TickVerdict]-?:
true }` roster whose keys are the list — but it turns that case's
`expect(FACT_FIELDS).not.toContain("errored")` into a tautology the typecheck
already holds, so whether the runtime allowlist survives at all is plan's
call, not mine mid-entry.

One surface note: `src/tickVerdict.ts` now exports the two type aliases above,
consumed only by the suite. Earned under *An export earns its consumer* (a
test counts); neither reaches the `exports` map, and neither sits in a shipped
signature position.
