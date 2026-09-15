# The absence verdict is mechanical; the rule bullet's shrink is the operator's

`tests/exportConsumers.test.ts` pins it. Measured on the tip: 343 judged
exports across `src/` + `harness/` — 191 earned by exports-map reachability,
152 by cross-module reference, 0 unearned. `bbf7091`'s cleanup held.

*An export earns its consumer*, bullet three, says the bullet "shrinks to a
pointer in the commit that ships it." Build cannot: `.claude/rules/**` is
outside the fence. That edit is the operator's. Bullet two (no bare grep) is
partly subsumed too — the scan resolves symbols through the TS compiler API,
so a host without `typescript-language-server` no longer leaves the *export*
verdict unmade. Bullet two still governs the wider dead-symbol case the
parked question covers.

Two things for the next rotation:

- The scan costs ~2.5s of the ~130s default lane: one `ts.createProgram` over
  the 110 files the root tsconfig describes.
- Reachability walks **type positions only**, skipping function bodies — a
  module-local helper a public method calls is not public surface. That is
  what keeps the verdict honest; stated at `scanExports`.
