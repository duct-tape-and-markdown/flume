# The loser's `ledger` bit is computed and still unreported

`waveWall` (`src/waveMerge.ts`) computes `ledger` for every wall it ranks,
including the ones it does not class. Only the classed wall spends it
(`WaveLedgerRefusal`, `TickResult.ledgerRefusal`); `UnclassedWall` carries
`event`/`signature`/`message` and no ledger half.

Judgment call taken here, not silently: `event` is now a closed set
(`WaveWallEvent`, `src/tickVerdict.ts`), and two of its four members -
"pending-ledger rewrite refused" and "mid-wave queue re-read refused" - are
exactly the ledger-refusing walls, so a chain keys on a typed discriminant
rather than pattern-matching prose. Nothing is rebuilt. If plan wants the
losing wall's class stated directly instead of read off a union member, that
is a `LedgerRefusalClass | undefined` field on `UnclassedWall` and a one-line
change at the ranking.

Second observation, shape not correctness: `waveWall`'s totality is held by a
destructuring default (`const [classed = mergeStageWall(held.mergeError)]`)
rather than by the type. The prior code had the same hole - its last arm
returned `held.mergeError` unconditionally - so this is not new debt, but the
non-empty guarantee still lives in `waveThrows` (`src/waveTick.ts`) and its
callers' discipline, not in a signature. Promoting it means the wave leg
handing `waveWallThrow` a holder set that cannot be empty by construction.

The unclassed walls also get one `log.warn` each at `waveWallThrow`, the only
place the ranking is known. Nothing downstream reads that line; the verdict
and `TickResult` are the surfaces.
