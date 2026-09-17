# The keyers were unreachable from a conforming chain

Shipping `phaseAttemptKey` from the package root alone would not have met the
acceptance. A chain takes every engine *value* off `api` — its only engine
import is `import type` (`src/flumeApi.ts`), pinned by "example chains — the
engine arrives on the api, never through a value import". So the two keyers
that shipped in THE-ATTEMPT-KEY-SHIPS-ON-THE-PACKAGES-SURFACE were reachable
only by a script, never by the chain the join defect was filed against, and
MIGRATING-0.16.md taught "both come from the package root" — a shape another
pin forbids.

Closed here: all three keyers ride `FlumeApi` beside `slugify` and
`priorAttemptPath`, and both pages teach `api.*`. Root exports kept for
non-chain consumers.

Worth a lens: every other engine fact a chain must not respell went onto
`api` (`gitPath`, `stopFlagPath`, `matchesAny`). "Ship it from the package
root" reads as adoption but lands out of a chain's reach. A sweep over
`src/index.ts` exports a chain needs at tick time but `FlumeApi` omits would
say whether this was the only one.
