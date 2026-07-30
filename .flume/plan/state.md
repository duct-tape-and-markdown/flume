# State

Phase: v0.7 mostly shipped (§10 amendment landed this delta, with a
gap found on audit); v0.8 boundary line (§§2-8) still queued. Mode:
**audit** (commit-delta only; no spec-delta, empty inbox, no
promotable blockedBy entries this tick).

## Queue (12)

1. `ENGINE-PIN-HANDSHAKE-JOB-RUN-FORM` — open (v0.7 §10, audit finding)
2. `STATUS-SUPERVISOR-LIVENESS` — open (v0.7 §17)
3. `DROPLASTCOMMIT-TIP-OWNERSHIP` — open (v0.7 §17)
4. `SUPERVISOR-PROVISION-QUARANTINE` — open (v0.7 §16)
5. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — open (v0.8 §2)
6. `REQUIRES-CAPABILITY-GENERALIZATION` — open (v0.8 §4)
7. `TICK-VERDICT-ARTIFACT` — open (v0.8 §5)
8. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #5 (v0.8 §3)
9. `PENDING-GATE-BUILTIN` — blockedBy #5 (v0.8 §6)
10. `SUPERVISOR-POLICY-KNOBS` — blockedBy #4 (v0.8 §8)
11. `SECOND-REFERENCE-CHAIN` — blockedBy #8 (v0.8 §7)

## Open questions

0.

## Trunk

HEAD `c66dfc5` at this pass's start; tree otherwise clean besides
untracked `.flume/loop.pid` (live supervisor artifact, not a plan
concern). `.claude/rules/collaboration.md` and `.flume/prompts/plan.md`
still carry uncommitted operator edits outside plan's writable paths —
not this tick's to commit.

Audited `851425a` (§10 amendment) against v0.7 §10: `handshakeFlumeDir`
correctly mirrors `resolveStateDirs`'s `--job`/`FLUME_JOB` precedence,
but misses the third job-scoping path — `flume job run <name>` rewrites
`jobFlag` in `main()` (src/cli.ts ~786-799) *after* the handshake has
already run, so a bay driven via `job new`+`job run` (the documented
standard workflow, no `--job` flag needed) has its handshake check the
bare-bay path instead of the job-scoped one. Filed as
`ENGINE-PIN-HANDSHAKE-JOB-RUN-FORM`. Files/scope of `851425a` otherwise
match its shipped entry's declared paths, no other drift.

Plan continues: no — commit-delta audited clean apart from the one
finding filed; no spec-delta, inbox empty, no blockedBy entries
unblocked this pass.
