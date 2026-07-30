# State

Phase: v0.7 §10's job-run-form amendment and its follow-on --max
validation gap are both shipped; v0.7 §§16-17 and v0.8 §§2-8 still
queued. Mode: **audit** (commit-delta only; no spec-delta, empty
inbox, no promotable blockedBy entries this tick).

## Queue (10)

1. `STATUS-SUPERVISOR-LIVENESS` — open (v0.7 §17)
2. `DROPLASTCOMMIT-TIP-OWNERSHIP` — open (v0.7 §17)
3. `SUPERVISOR-PROVISION-QUARANTINE` — open (v0.7 §16)
4. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — open (v0.8 §2)
5. `REQUIRES-CAPABILITY-GENERALIZATION` — open (v0.8 §4)
6. `TICK-VERDICT-ARTIFACT` — open (v0.8 §5)
7. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #4 (v0.8 §3)
8. `PENDING-GATE-BUILTIN` — blockedBy #4 (v0.8 §6)
9. `SUPERVISOR-POLICY-KNOBS` — blockedBy #3 (v0.8 §8)
10. `SECOND-REFERENCE-CHAIN` — blockedBy #7 (v0.8 §7)

## Open questions

0.

## Trunk

HEAD `4c645c2` at this pass's start; tree otherwise clean besides
untracked `.flume/loop.pid` (live supervisor artifact, not a plan
concern). `.claude/rules/collaboration.md` and `.flume/prompts/plan.md`
still carry uncommitted operator edits outside plan's writable paths —
not this tick's to commit.

Audited `394fc4f` (--max validation fix, closing the prior audit
finding) against v0.7 §10: `handshakeJobRunName` now checks the
`--max` value is present and non-dash before splicing, field-for-field
matching main()'s own job-run rewrite (src/cli.ts:826-834) — same
`maxIdx` lookup, same presence/dash check, same bail-to-undefined on
failure. New tests cover both malformed shapes (dash-value,
missing-value); scope matches the shipped entry's declared files
exactly, no drift. `4c645c2` is the mechanical ship (pending-entry
removal) — matches. No further findings.

Plan continues: no — commit-delta audited clean, no findings; no
spec-delta, inbox empty, no blockedBy entries unblocked this pass.
