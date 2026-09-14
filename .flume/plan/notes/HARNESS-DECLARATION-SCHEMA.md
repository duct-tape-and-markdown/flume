# Declaration shape landed; two rulings the chain-factory entry needs first

**The declaration cannot be a JSON file.** `runner` is a live value — three
operations, and *The runner interface* says a consumer "declares its own" — so
the schema parses an object, not JSON bytes. *What this repo is* says chain.ts
is "the harness factory applied to `.flume/declaration.json`"; *The cite
resolver*'s "may declare a resolver" is the same shape. Needs a ruling:
declaration as a TS module, or JSON plus a TS sidecar carrying the values.

**`supervisor` names four knobs; the engine's `supervisorPolicy` has five.**
The spec table omits `quarantineScope` (src/Phase.ts:576). I shipped the four
named, tied to the engine's type by `Pick`, so a consumer cannot declare it.
Deliberate, or dropped?

Judgment calls, cheap to revisit: `slices` required (its sweep domain has no
sane default); `slots` strict to {autonomy, domain}; `setup` = {directories,
restore}; a gate's registry `name` is any non-empty string — the factory
refuses an unknown one at the same load.
