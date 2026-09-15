# The integration lane declares no shared spawn budget

Now that the scan reads both lanes, the integration lane's shape is visible:
all 22 of its spawning cases carry a bare numeric timeout (`30_000`, one
`240_000`) rather than a named constant — exactly the "restates a number of
its own" verdict the default lane's budget assertion rejects. That assertion
stays default-lane-only here, so nothing reds; extending it as written would
red all 22. Plan's fork: give the integration lane its own named budget in
`tests/helpers/subprocess.ts` and widen the assertion, or declare the
divergence (the lane's ceilings genuinely differ per case, which a single
constant would flatten).

Bound on the new timer scan, declared at its site: the propagation is
per-lane-file and never follows an import, so `waitFor` reads as the
event-based wait it is rather than as the `setTimeout` under it — and a fixed
sleep hidden behind a *new* helper module would be invisible. Call sites are
where this scan looks.
