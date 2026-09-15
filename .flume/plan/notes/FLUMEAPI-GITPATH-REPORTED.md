# The spec's FlumeApi enumerations do not name gitPath

`gitPath` now rides `FlumeApi`, but two human-owned spec sentences enumerate
that surface and neither mentions it:

- `spec/pending.md`, *What the package exports* — "`src/index.ts` and
  `FlumeApi` are the canonical lists. Both carry the *values* ... `slugify`,
  and `priorAttemptPath`." Reads as exhaustive; `gitPath` was already missing
  from the `src/index.ts` half before this entry, so the omission predates it.
- `spec/chain.md`, *the chain surface* — names "the path-glob matcher
  `matchesAny`" as the engine rule a chain reaches for path policy. The
  separator rule beside it is now reachable the same way.

Build cannot touch `spec/`, so this is plan's to route.

Scope widened by one file beyond the entry's prediction:
`examples/backlog-groomer-chain.ts`'s adoption block (step 2) told a copying
consumer to add `import { isPickableNow, parsePending, renderSchemaForPrompt }
from "flume"` — a runtime value import of symbols the file already destructures
off `api`. Same defect class as the cascade one this entry removes, fixed in
the same commit rather than left teaching it.
