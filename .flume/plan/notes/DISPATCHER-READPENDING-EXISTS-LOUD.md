# loadChainModule's chain.ts probe is the same check, still on existsSync

Shipped as written: the relocated branch of the strict `readPending`
(`src/Dispatcher.ts`) now probes with `existsLoud`, absent still reads `[]`,
and the four sites the entry declared out of scope are untouched.

Observed while surveying the file's remaining `existsSync` callers: two
places check that `<configDir>/chain.ts` exists, and they disagree.
`jobNew` (`src/job.ts:214`) uses `existsLoud`; `loadChainModule`
(`src/Dispatcher.ts:1021`) — which `jobNew` calls one line later, and which
its own docstring names as "the single fix point for this check" — still
uses `existsSync`. An unstattable chain.ts therefore throws "chain config
not found", naming absence for a file that is there. It refuses either way,
so this is not a silent proceed; the defect is the misreport and the
sibling divergence (`engineering.md`, *The fix lands at the mechanism*:
detection a sibling surface already performs is shared, never re-derived).
Small, mechanical, and it would let the docstring's "single fix point"
claim hold for real.
