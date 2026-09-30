# The mirror is derived from the two shapes, not listed

`mirrorFailureBuckets` (`src/Dispatcher.ts`) keys off `MirroredBucket`, a type
reading every name `TickOutcome` and `TickVerdict` both declare holding rows.
It resolves to the seven buckets today, and the runtime key map is typed
against it, so a bucket added to both shapes and not to the map reds `tsc`
(measured: dropping `shipFailures` errors TS2741).

Two things for plan:

- `TickVerdict.stakeLosses` has no `TickOutcome` field, so it is the one
  verdict record bucket the handoff surface never names. A chain sees stake
  losses only via `result.stakeLosses` or by opening the verdict. Whether that
  asymmetry is deliberate is stated nowhere I found; if it is not, adding the
  field is now one key the typecheck forces through both arms.
- The walled arm now mirrors the six stage buckets as well as
  `unclassedWalls`. `tickExitCode` (`src/cliVerdict.ts`) reads `TickOutcome`
  and no arm keys on these buckets, so no exit code moved — but a downstream
  supervisor treating "bucket absent on a failed tick" as "no such failure"
  now sees rows it did not before. That is the entry's point, noted so a
  release line can say it.

The prior case "the ledger-refusal verdict names a render refusal raised after
the refusing pick" and the new one share one fixture helper
(`walledWaveWithRenderRefusal`, `tests/Dispatcher.test.ts`) rather than a
second copy of the ~85-line wave setup.
