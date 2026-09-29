# All three relocated-root skips are now asserted

Both new cases in `tests/harnessGates.test.ts` copy the records gate's shape:
a judged run off a real commit that carries the thing the gate rules on (an
added entry file, a moved derive cursor), then the `computeStateRootRel` pin
proving the relocated root really resolves outside the repo, then the same
span re-gated at that root and read for the spelled `skipped` reason.

Mutation-checked on this tree: deleting the filing-band arm and replacing the
slice-state arm with a throw reds both cases, so a dropped arm cannot ship
green.

One observation for the sweep. The three arms spell three different skip
reasons for one condition, and each is matched verbatim in its case — that is
right, since the reasons say different things about different gates, but it
means the condition `ctx.stateRootRel === undefined` is now written out three
times in `harness/gates.ts` (`:346`, `:459`, `:706`). A fourth gate that reads
the state root will spell it a fourth time, and nothing holds that a new gate
answers a relocated root at all. Not correctness-adjacent today — every gate
that reads the root has the arm — so it is noted as shape, not filed.
