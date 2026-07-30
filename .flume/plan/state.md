# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-10,
including the §10 migration-guide amendment). No v0.9 spec yet.

Mode: audit (commit-delta: two build commits + one harness ship-commit;
inbox and spec-delta both empty; pending-now empty, nothing to promote).

## Queue (1)

1. `CHANGELOG-UNRELEASED-POST-0.8.0-FIXES` — open. Two build commits
   since the 0.8.0 cut (11f2613, 21ff4e5) shipped without a CHANGELOG
   line, breaking the established in-commit-entry convention; file
   restores it.

## Open questions (0)

None.

## Trunk

HEAD `efb5ca7`. Audited `21ff4e5` (pin-handshake self-ref → authority)
against v0.7 §10's amendment: `readLocalInstall`'s new `"self"` outcome
and `engineHandshake`'s arm-3 treatment match the spec text exactly;
tests at `tests/cli.test.ts:530-577` cover both pinned (proceeds) and
unpinned (no-op) self-ref cases; files touched match the entry's
declaration, no creep. Audited `11f2613` (pendingGate `fenceWhen`)
against v0.8 §6: additive, default-preserves-behavior predicate,
tested for omitted/exempted/still-checked cases at
`tests/Gate.test.ts`; dogfood `chain.ts` doesn't yet pass a `fenceWhen`
(no park-exempt `gate.kind` in current use), consistent with the
entry's ask. `efb5ca7` is a harness ship-commit (pending.json only),
nothing to audit. Found one gap: neither build commit added a
CHANGELOG entry, unlike every prior build commit in history (e.g.
26c0b06, f55aa9a) — filed as `CHANGELOG-UNRELEASED-POST-0.8.0-FIXES`.

Plan continues: no
