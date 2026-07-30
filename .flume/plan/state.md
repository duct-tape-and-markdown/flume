# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-8 —
§7 landed this delta via SECOND-REFERENCE-CHAIN). No v0.9 spec yet.

Mode: **audit** (commit-delta: SECOND-REFERENCE-CHAIN build + ship,
checked against v0.8 §7).

## Queue (0)

Empty — no spec-delta, nothing pending.

## Open questions (5)

- `STALE-GLOBAL-FLUME-LOOP` — **urgent, confirmed active**: this plan
  session's own process tree resolves to the stale global
  `@dtmd/flume@0.5.0` loop. Needs human process action.
- `INTEGRATION-LANE-NEVER-RUNS-IN-CI` — **new**: v0.3 §17's integration
  lane (`pnpm test:integration`) has no CI wiring, and
  `job.integration.test.ts` hangs on its §5b lock-refusal test — needs
  root-cause before CI wiring is safe.
- `PENDING-GATE-DOGFOOD-ADOPTION` — unchanged, operator leg.
- `BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged.
- `CONSUMER-SMOKE-PIN-HANDSHAKE-BREAK` — unchanged, operator leg.

## Trunk

HEAD `546d572` (ship SECOND-REFERENCE-CHAIN). Audited clean against
§7: entry extension + lowercase-kebab tag refinement compose correctly,
deterministic groom agent keeps the example dependency-free, docs carry
the two-chains framing throughout, CI smoke step and vitest integration
test both cover the acceptance line, `entry.files` scope respected (no
creep), zero `src/` changes. No spec-delta, inbox empty, pending-now
empty (nothing to promote).

Plan continues: no
