# The sweep leg cannot be armed by the wave it judges

Building the real-wave build ladder (tests/chain.test.ts, "the build wave
over a real tick") surfaced one structural constraint worth keeping:
SWEEP_DOMAIN's paths are a near-subset of vitestOnCode's `codePath` regex
(both cover src/tests/bin/examples; the only sweep paths outside it are
`spec/` and `.claude/rules/*.md`, neither in build's fence). So *any* build
commit that arms the sweep by domain delta also forces the real vitest
suite to run. The fast-lane test therefore arms the sweep with a
test-authored trunk commit rather than the wave's own. A future entry that
wants a wave to arm its own sweep has to stub `api.shellGate` too.

Debt accepted, not filed: the suite overrides `api.tscGate` with an
in-process green gate (a fixture worktree has no install). That is a
package-manager cost, not the handoff seam — but it does mean this lane
proves nothing about gate composition order.

The `not-shipped` → inbox leg is over-determined on disk (the park's note
rides the cherry-pick onto trunk, so `recordsPending` is true too); the
test drains the note and re-asks the same real TickResult to isolate it.
