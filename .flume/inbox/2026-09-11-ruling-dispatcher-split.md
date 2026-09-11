# Ruling: split the acyclic concerns out of Dispatcher.ts (human)

Closes *src/Dispatcher.ts bundles several jobs*. Option C: extract the
worktree / friction / prior-attempt helpers and the loop supervisor into
their own modules; chain-load plus tick execution stay together with
`buildFlumeApi`, whose cycle constraint (`Dispatcher.ts:42-44`) is the
declared reason. Pure moves — no behavior change, public surface via
`src/index.ts` unchanged, tests move with their subjects and change only
in import paths. One module per entry, each independently green, ordered
by `blockedBy` where an extraction depends on a prior one.
