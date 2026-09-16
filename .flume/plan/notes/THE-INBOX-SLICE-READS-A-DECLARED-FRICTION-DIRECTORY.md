# The friction channel has no listing surface, so a fourth reader composed one

Shipped. Two things for the next tick.

1. The engine owns the friction channel but reports no *listing* of it. It
shares only the name test (`isDotName`, `src/paths.ts`); the `readdir` +
`isFile() && !isDotName` + sort idiom around it is now spelled at four sites:
`src/cli.ts` (the bare `friction` listing), `countFrictionFiles`
(`src/job.ts`), `harvestFriction` (`src/friction.ts`), and now
`frictionFiles` (`harness/friction.ts`). The fourth is a consumer restating
an engine fact (`.claude/rules/engineering.md`, *A fact the engine holds is
reported, never rediscovered*). One home — a `frictionNotes(dir)` in
`src/friction.ts` — would also break the existing
`job.ts -> chainLoad.ts -> friction.ts -> job.ts` import cycle. Not filed as
part of this entry: it is an `src/` refactor with its own blast radius.

2. This repo's `.flume/declaration.ts` declares no `friction`, so the leg
ships dark here — exercised only by `tests/`. Declaring it is a
`chore(flume):` commit outside build's fence.
