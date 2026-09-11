# The dogfood chain's header still teaches the pre-0.10 module shape

`.flume/chain.ts:1-2` reads "Loaded by the flume CLI from `.flume/chain.ts`;
the default export is the Chain" — the shape `loadChainModule` refuses. It is
the one site the new pin
(`tests/retired-narration.test.ts`, "no chain-authoring surface teaches the
pre-0.10 module shape") reports and cannot have fixed: `.flume/chain.ts` is
outside every phase lane, so it is named in that test's `UNFIXED_SITES` with
what it still says, not accepted as a denial.

Mechanical if taken: say the default export is a factory `(api) => ({ chain })`
whose return carries `agent`, then delete the `UNFIXED_SITES` entry — the pin
fails until both halves land. A `chore(flume):` commit from an interactive
session, never a pending entry.
