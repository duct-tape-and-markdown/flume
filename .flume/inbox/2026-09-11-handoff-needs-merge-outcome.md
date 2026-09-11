# build.handoff cannot tell a park from a cherry-pick conflict on TickResult (human)

`FanoutEntryOutcome` (`src/Phase.ts`) reports `committed`, `shipped`,
`reverted`, `noCommit`. A park (merged, chain's `shipped` said no) and a
conflict (never merged) read identically: committed, not shipped, not
reverted. The verdict carries the fact (`mergeOutcomes[].outcome`), but it
is written after `handoff` runs, so the chain cannot read it either way.
A handoff routing a park to plan therefore wakes plan on a conflict too,
and pays a declined tick (`.flume/chain.ts`, `build.handoff`). Report the
merge outcome per entry on `TickResult.entries` (`mergeOutcome`)
(`engineering.md`, *A fact the engine holds is reported*); the chain's
workaround and its comment go in the adopting commit. Observed 2026-09-11.
