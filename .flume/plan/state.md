# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-8). No
v0.9 spec yet.

Mode: audit (3 commits since last plan: the two builds that shipped
last tick's queue, plus the ship commit) + maintain (inbox empty,
nothing to promote).

## Queue (0)

Empty — both prior entries shipped clean.

## Open questions (0)

None.

## Trunk

HEAD `346a27e`. Audited 88fa714 (CI wiring, v0.3 §17) — `pnpm
test:integration` step added to the `ci` (ubuntu) job only; windows
job stays fast-lane + smoke:install, consistent with §17 (POSIX
primary target) and out of scope for this entry. Audited 5308e3f
(handshake unit gap, v0.7 §10) — two new cli.test.ts cases symlink a
bare bay's `.flume/node_modules/@dtmd/flume` at REPO_ROOT, exercising
arm 2 (pinned, refuses) and arm 3 (unpinned, no-op) directly; matches
the resolveStateDirs-derived path from the 2026-07-30 amendment.
Audited 346a27e (ship commit) — pending.json correctly cleared, no
scope creep. Verified locally: `tsc --noEmit` clean, `pnpm test`
343/343 green. No findings.

Plan continues: no
