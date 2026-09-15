# The renamed row leaves one stale name in the spec lane

`TickVerdictGateResult` is now `ReportedGateResult` — one row shape for the
verdict, `TickResult.gateResults` and `ShipContext.gateResults` alike, so the
name no longer claims the verdict owns it. Renamed everywhere build can
reach: `src/Dispatcher.ts` (the interface, and the `GateResultEntry` local
accumulator it absorbed — that was the third copy), `src/index.ts`,
`docs/CHAIN-AUTHORING.md`, `tests/Dispatcher.test.ts`.

`spec/loop.md`, *The tick verdict*, still names `TickVerdictGateResult` for
the same row (line ~561). Build cannot edit `spec/`, so it stands as the one
stale cite. Worth routing to the human lane with the rest of the spec edits
this widening implies.

No consumer to clean up: neither `.flume/chain.ts` nor `examples/` reads
`gateResults` at all today, so nothing was pattern-matching `message` for a
discriminant — the fields were riding and the type was the only thing hiding
them.
