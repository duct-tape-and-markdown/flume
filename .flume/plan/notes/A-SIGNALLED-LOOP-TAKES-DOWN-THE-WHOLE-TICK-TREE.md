# killGraceMs shipped; two consumers still name five knobs

`src/processTree.ts` is the shared home (own-group spawn, then SIGTERM/grace/
SIGKILL). `defaultTickRunner` takes it; the bare tick does not yet, which is
A-BARE-TICK-TAKES-ITS-AGENT-DOWN-THE-SAME-WAY.

Both specs already name the sixth knob. Two consumers do not, and no gate
reads either:

- `src/cliHelp.ts` quotes `abortThreshold` and no other supervisor knob. A
  signalled loop's wait is operator-visible in a way a batch width is not, so
  a help line looks warranted, but its wording is a UX call I did not make.
- `docs/CHAIN-AUTHORING.md` section 9 now documents 3 of 6. I added
  `killGraceMs` only; `maxParallel`, `tickTimeoutMs` and `partitionIgnore`
  were already absent there before this entry.

Observed: a case that blows `SPAWN_BUDGET_MS` runs neither its `finally` nor
the driver's `catch`, so a parked tree outlives the case. The teardown arms
drain recorded pids in an `afterEach` instead.
