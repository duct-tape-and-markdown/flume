# The singleton's provisioning no-run return is one closure; the prune leg stays out by shape

Folded. `provisionNoRun` sits beside `provisionFailures` in `runSingleton`
(`src/singletonTick.ts`) and owns the push, the `[...provisionFailures]`
snapshot, and the outcome naming that one array on both surfaces. The
`createWorktree` and `setupWorktree` catches each keep their own `log.warn`
and return through it; the teardown stays ahead of the call on the
`setupWorktree` leg alone. Behavior-free: tsc clean, 2195 tests pass.

Two things for the next sweep of this neighborhood, so neither gets refiled:

- The prune catch above pushes and *continues* — it is not a fourth caller,
  and folding it would change behavior (a prune wall must not end the tick).
  The shape difference is intentional and now reads as such, since the two
  returning legs are visibly one call and the prune leg visibly is not.
- `runFanout` (`src/waveTick.ts`) accumulates `provisionFailures` too, but
  per entry with `blamedOn(entry)` and without returning, and it spreads the
  array conditionally at its two exits. Not the same sequence — checked this
  tick, so a cross-module "one spelling" finding there would be new ground,
  not this family recurring.
