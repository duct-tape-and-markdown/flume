# The acceptance gate cannot see a behavior pinned in the integration lane (human)

Loop of 2026-09-11: CASCADE-SHOULDRUN-FROM-DISK was reverted once with "1 of
1 named behavior(s) have no passing test". The test existed, in
`tests/examples.integration.test.ts` — the lane `vitest.config.ts` excludes
from the default run, which is what the `vitest` gate invokes. The retry
moved the pin to a fast-lane file (`tests/examples.test.ts`) and shipped.
Two readings: a `tests[]` / `pins[]` line must be fast-lane-testable, and
`.flume/prompts/plan-discipline.md` should say so (cheap, prose, this
chain's convention); or the gate runs the integration lane when an entry
touches `examples/` (a second suite per merge, slow). The first is the
right default; the three remaining CASCADE-* entries are the ones this
bites next.
